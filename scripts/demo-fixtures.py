#!/usr/bin/env python3
"""Generate small, reproducible fictional CareVault document-processing fixtures."""
import argparse
import hashlib
import io
import json
from pathlib import Path

from PIL import Image, ImageOps
import pypdfium2 as pdfium
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[1]
PAGE = (612, 792)
INK = colors.HexColor('#163735')
TEAL = colors.HexColor('#14645c')
PALE = colors.HexColor('#eaf3f0')
DISCLAIMER = 'FICTIONAL DEMO RECORD - illustrative values, not medical advice'
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='DemoTitle', fontName='Helvetica-Bold', fontSize=24, leading=29, textColor=INK, spaceAfter=16))
styles.add(ParagraphStyle(name='DemoHeading', fontName='Helvetica-Bold', fontSize=12, leading=16, textColor=TEAL, spaceBefore=16, spaceAfter=7))
styles.add(ParagraphStyle(name='DemoBody', fontName='Helvetica', fontSize=10, leading=15, textColor=INK, spaceAfter=6))
styles.add(ParagraphStyle(name='DemoLabel', parent=styles['DemoBody'], fontName='Helvetica-Bold', fontSize=9))
styles.add(ParagraphStyle(name='DemoSmall', parent=styles['DemoBody'], fontSize=8, leading=12))


def p(text, style='DemoBody'):
    return Paragraph(text, styles[style])


def table(rows, widths=(134, 370), header=False):
    cells = [[p(str(cell), 'DemoLabel' if index == 0 or (header and row_index == 0) else 'DemoBody') for index, cell in enumerate(row)] for row_index, row in enumerate(rows)]
    result = Table(cells, colWidths=widths, hAlign='LEFT')
    result.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('ROWBACKGROUNDS', (0, 0), (-1, -1), [PALE, colors.white]),
        ('LINEBELOW', (0, -1), (-1, -1), 0.5, colors.HexColor('#cdded8')),
    ]))
    return result


def frame(pdf, document):
    pdf.saveState()
    pdf.setFillColor(TEAL)
    pdf.rect(0, 756, 612, 36, fill=1, stroke=0)
    pdf.setFillColor(colors.white)
    pdf.setFont('Helvetica-Bold', 9)
    pdf.drawString(54, 770, 'CAREVAULT / FICTIONAL RESPIRATORY-CARE SERIES')
    pdf.setFont('Helvetica', 8)
    pdf.setFillColor(INK)
    pdf.drawString(54, 35, DISCLAIMER)
    pdf.drawRightString(558, 35, str(document.page))
    pdf.restoreState()


def fixed_canvas(*args, **kwargs):
    kwargs['invariant'] = 1
    return canvas.Canvas(*args, **kwargs)


def write_pdf(path, title, date, body):
    document = SimpleDocTemplate(str(path), pagesize=PAGE, topMargin=63, bottomMargin=57, leftMargin=54, rightMargin=54,
                                 title=f'{title} - fictional demo', author='CareVault fictional fixtures', subject=DISCLAIMER)
    document.build([p(title, 'DemoTitle'), p(f'Document date: {date} | Demo record: CV-DEMO-0034', 'DemoSmall'), Spacer(1, 8)] + body,
                   onFirstPage=frame, onLaterPages=frame, canvasmaker=fixed_canvas)


def render(path):
    with pdfium.PdfDocument(str(path)) as pdf:
        if len(pdf) != 1:
            raise ValueError(f'Expected one page: {path.name}')
        page = pdf[0]
        bitmap = page.render(scale=2)
        image = bitmap.to_pil().convert('RGB')
        bitmap.close()
        page.close()
        return image


def generate(output):
    output.mkdir(parents=True, exist_ok=True)
    identity = [('Patient', 'Alex Morgan'), ('Age at encounter', '34 years'), ('Contact', 'alex.morgan@example.test<br/>+1 202-555-0148'), ('Address', '100 Example Lane, San Diego')]
    write_pdf(output / 'respiratory-intake.pdf', 'Patient intake', '2026-09-29', [
        table(identity),
        p('Reason for visit', 'DemoHeading'),
        p('Patient reports intermittent cough for two weeks. This history is fictional and does not establish a diagnosis.'),
        p('Reported history', 'DemoHeading'),
        table([('Allergies', 'Patient reports a peanut allergy; reaction details not recorded and clinical confirmation is required.'),
               ('Medications', 'Legacy entry: Medication A - illustrative prescription only. Actual drug, dose, and current use are not established.'),
               ('Administration need', 'Difficulty swallowing large tablets.')]),
        p('Care preferences', 'DemoHeading'),
        p('English. Secure portal messages. Tuesday and Thursday afternoons are preferred for appointments.'),
    ])
    write_pdf(output / 'respiratory-visit.pdf', 'Respiratory visit note', '2026-09-29', [
        table([('Patient', 'Alex Morgan, age 34'), ('Contact', 'alex.morgan@example.test | +1 202-555-0148'), ('Record status', 'Fictional note. No clinician has verified this record.')]),
        p('History provided', 'DemoHeading'),
        p('Alex Morgan reports intermittent cough for two weeks and difficulty swallowing large tablets. A peanut allergy is reported; reaction details are not established.'),
        p('Illustrative observations', 'DemoHeading'),
        table([('Temperature', '36.8 degrees C'), ('Pulse', '78 beats/min'), ('Respiratory rate', '16 breaths/min'), ('Oxygen saturation', '98% on room air')]),
        p('Documentation', 'DemoHeading'),
        p('No confirmed respiratory diagnosis is assigned in this fictional note. Example laboratory results are attached as a separate demo record dated 2026-09-30.'),
        p('An attributed research chest X-ray may be attached separately for software testing. It is not an image of Alex Morgan and is not evidence for this fictional clinical history.'),
        p('No treatment recommendation is supplied. Medication reconciliation and allergy confirmation are incomplete.'),
    ])
    write_pdf(output / 'respiratory-labs.pdf', 'Illustrative laboratory report', '2026-09-30', [
        table([('Patient', 'Alex Morgan, age 34'), ('Specimen ID', 'DEMO-SPEC-0034'), ('Collected', '2026-09-30 09:15 - fictional collection'), ('Ordering context', 'Fictional respiratory-care software demonstration')]),
        p('Example results', 'DemoHeading'),
        table([('Test', 'Result', 'Unit'), ('White blood cells', '7.4', '10^9/L'), ('Hemoglobin', '14.2', 'g/dL'), ('Platelets', '248', '10^9/L'), ('C-reactive protein', '3.0', 'mg/L')], widths=(270, 94, 140), header=True),
        p('Interpretation status', 'DemoHeading'),
        p('These values are invented to test text extraction and table layout. They are not measured results. No reference intervals, diagnostic interpretation, or treatment advice is provided.'),
        p('Provenance', 'DemoHeading'),
        p('Generated by the CareVault fixture script. The dates and identifiers link this example to the fictional intake and visit note. It is not derived from an NIH patient record.'),
    ])
    intake = render(output / 'respiratory-intake.pdf')
    scan = ImageOps.grayscale(intake)
    buffer = io.BytesIO()
    scan.save(buffer, format='JPEG', quality=82, optimize=True)
    scan_pdf = canvas.Canvas(str(output / 'respiratory-intake-scanned.pdf'), pagesize=PAGE, invariant=1)
    scan_pdf.setTitle('Fictional patient intake - raster-only scanned variant')
    scan_pdf.setAuthor('CareVault fictional fixtures')
    scan_pdf.drawImage(ImageReader(io.BytesIO(buffer.getvalue())), 0, 0, width=PAGE[0], height=PAGE[1])
    scan_pdf.save()
    photo = ImageOps.expand(intake, border=28, fill='#d9d5cd').rotate(1.2, resample=Image.Resampling.BICUBIC, expand=True, fillcolor='#d9d5cd')
    photo.save(output / 'respiratory-intake-photo.jpg', format='JPEG', quality=82, optimize=True)
    manifest = json.loads((ROOT / 'demo' / 'manifest.json').read_text())
    total = sum((output / entry['filename']).stat().st_size for entry in manifest['records'])
    if total > 1_000_000:
        raise ValueError(f'Fixture output exceeds 1 MB: {total}')
    for entry in manifest['records']:
        path = output / entry['filename']
        print(f'{path.name}: {path.stat().st_size} bytes; sha256={hashlib.sha256(path.read_bytes()).hexdigest()}')
    print(f'Total: {total} bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['generate'])
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'demo' / 'files')
    args = parser.parse_args()
    generate(args.output_dir)
