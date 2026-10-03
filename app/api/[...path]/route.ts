import { handleRequest } from '../../../lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const route = (request: Request) => handleRequest(request);
export const GET = route;
export const POST = route;
export const PUT = route;
export const DELETE = route;
