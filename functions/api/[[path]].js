// Former tool APIs are retired for every HTTP method, including CORS preflight.
export function onRequest() {
    return new Response(JSON.stringify({ error: 'Former tools have been removed from OrderSkew.' }), {
        status: 410,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
}
