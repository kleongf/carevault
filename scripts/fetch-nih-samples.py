#!/usr/bin/env python3
"""Fetch three NIH research PNGs with bounded byte ranges, never a full ZIP."""
import argparse
import csv
import hashlib
import io
import json
import re
import struct
import urllib.request
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REVISION = '36778e3b0e4f4b4fad31d1728d6190f3eda5b543'
BASE = f'https://huggingface.co/datasets/alkzar90/NIH-Chest-X-ray-dataset/resolve/{REVISION}'
ARCHIVE = f'{BASE}/data/images/images_001.zip'
METADATA = f'{BASE}/data/Data_Entry_2017_v2020.csv'
MAX_IMAGE = 2_000_000


def range_get(url, start, end):
    if end < start or end - start + 1 > 2_000_000:
        raise ValueError('Range outside the download limit')
    request = urllib.request.Request(f'{url}?download=true&cv_range={start}-{end}', headers={'Range': f'bytes={start}-{end}'})
    with urllib.request.urlopen(request, timeout=45) as response:
        match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', response.headers.get('Content-Range', ''))
        if response.status != 206 or not match or int(match[1]) != start or int(match[2]) != end:
            raise ValueError('Server did not honor byte ranges; refusing full archive download')
        data = response.read(end - start + 2)
        if len(data) != end - start + 1:
            raise ValueError('Truncated or oversized range response')
        return data, int(match[3])


def archive_directory():
    _, total = range_get(ARCHIVE, 0, 0)
    tail, _ = range_get(ARCHIVE, max(0, total - 65557), total - 1)
    position = tail.rfind(b'PK\x05\x06')
    if position < 0:
        raise ValueError('ZIP end directory missing')
    end = struct.unpack('<4s4H2IH', tail[position:position + 22])
    if end[1] != 0 or end[2] != 0 or end[5] == 0xffffffff or end[6] == 0xffffffff:
        raise ValueError('Split or ZIP64 archives are not supported')
    central, _ = range_get(ARCHIVE, end[6], end[6] + end[5] - 1)
    entries = {}
    position = 0
    while position < len(central):
        values = struct.unpack('<4s6H3I5H2I', central[position:position + 46])
        if values[0] != b'PK\x01\x02':
            raise ValueError('Invalid ZIP central directory')
        name = central[position + 46:position + 46 + values[10]].decode('utf-8')
        entries[name] = {'flags': values[3], 'method': values[4], 'crc': values[7], 'compressed': values[8], 'size': values[9], 'offset': values[16]}
        position += 46 + values[10] + values[11] + values[12]
    return entries


def selected_metadata(entries):
    # The first half megabyte contains early subjects in images_001. A bounded
    # read also handles plain Git blobs whose server ignores Range for CSV files.
    request = urllib.request.Request(METADATA, headers={'Range': 'bytes=0-524287'})
    with urllib.request.urlopen(request, timeout=45) as response:
        if response.status not in (200, 206):
            raise ValueError('Metadata unavailable')
        prefix = response.read(524288)
    text = prefix.rsplit(b'\n', 1)[0].decode('utf-8-sig')
    rows = list(csv.DictReader(io.StringIO(text)))
    selected, patients = [], set()
    for label in ['No Finding', 'Mass', 'Nodule']:
        row = next((row for row in rows if row['Finding Labels'] == label and row['Patient ID'] not in patients and f"images/{row['Image Index']}" in entries), None)
        if row is None:
            raise ValueError(f'No distinct-participant {label} sample in the bounded metadata prefix')
        patients.add(row['Patient ID'])
        selected.append(row)
    return selected


def extract_image(name, entry):
    if entry['flags'] & 1 or entry['method'] not in (0, 8) or entry['size'] > MAX_IMAGE or entry['compressed'] > MAX_IMAGE:
        raise ValueError('Unsupported or oversized ZIP member')
    offset = entry['offset']
    header, _ = range_get(ARCHIVE, offset, offset + 29)
    values = struct.unpack('<4s5H3I2H', header)
    if values[0] != b'PK\x03\x04' or values[3] != entry['method']:
        raise ValueError('Invalid ZIP local header')
    local_name, _ = range_get(ARCHIVE, offset + 30, offset + 29 + values[9])
    if local_name.decode('utf-8') != name:
        raise ValueError('ZIP filename mismatch')
    start = offset + 30 + values[9] + values[10]
    compressed, _ = range_get(ARCHIVE, start, start + entry['compressed'] - 1)
    if entry['method'] == 8:
        decoder = zlib.decompressobj(-15)
        data = decoder.decompress(compressed, MAX_IMAGE + 1)
        if not decoder.eof or decoder.unconsumed_tail:
            raise ValueError('Compressed PNG exceeded bounds or was incomplete')
    else:
        data = compressed
    if len(data) != entry['size'] or zlib.crc32(data) != entry['crc'] or not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('PNG size, signature, or ZIP checksum mismatch')
    return data


def fetch(output, manifest_path):
    entries = archive_directory()
    rows = selected_metadata(entries)
    output.mkdir(parents=True, exist_ok=True)
    records = []
    for row in rows:
        name = row['Image Index']
        member = f'images/{name}'
        data = extract_image(member, entries[member])
        filename = f'nih-{name}'
        (output / filename).write_bytes(data)
        records.append({
            'filename': filename, 'originalFilename': name,
            'title': f"NIH research X-ray - {row['Finding Labels']} label",
            'mime': 'image/png', 'profile': 'identifiers',
            'patientId': row['Patient ID'], 'labels': row['Finding Labels'].split('|'),
            'patientAge': row['Patient Age'], 'patientSex': row['Patient Gender'], 'viewPosition': row['View Position'],
            'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data),
            'sourceUrl': ARCHIVE, 'archiveMember': member, 'metadataUrl': METADATA, 'revision': REVISION,
            'provenance': 'NIH Clinical Center ChestX-ray14 research image from a real de-identified research subject. This is not an image of fictional patient Alex Morgan. Finding labels are text-mined dataset annotations, not confirmed diagnoses.',
        })
        print(f"{filename}: {len(data)} bytes; label={row['Finding Labels']}; research subject={row['Patient ID']}")
    manifest = {
        'version': 1, 'dataset': 'NIH Clinical Center ChestX-ray14',
        'datasetCard': 'https://huggingface.co/datasets/alkzar90/NIH-Chest-X-ray-dataset',
        'originalDataset': 'https://nihcc.app.box.com/v/ChestXray-NIHCC',
        'citation': 'Wang X, Peng Y, Lu L, Lu Z, Bagheri M, Summers RM. ChestX-ray8: Hospital-scale Chest X-ray Database and Benchmarks on Weakly-Supervised Classification and Localization of Common Thorax Diseases. CVPR 2017, pp. 3462-3471. https://arxiv.org/abs/1705.02315',
        'attribution': 'NIH Clinical Center is the original data provider. Hugging Face alkzar90 hosts the downloaded mirror.',
        'acquisitionNotes': 'Three original PNG members extracted with strict HTTP 206 byte ranges from a revision-pinned ZIP; no complete archive downloaded. ZIP CRC32 and output SHA-256 checked. Metadata read only from the first 524288 bytes of the revision-pinned CSV. Distinct research subjects selected for exact No Finding, Mass, and Nodule labels. Not a clinical validation set; sample selection is label-based.',
        'records': records,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f"Wrote manifest: {manifest_path}; total PNG bytes: {sum(record['bytes'] for record in records)}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'demo' / 'files')
    parser.add_argument('--manifest', type=Path, default=ROOT / 'demo' / 'nih-manifest.json')
    args = parser.parse_args()
    fetch(args.output_dir, args.manifest)
