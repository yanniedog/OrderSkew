export function onRequest(context) {
  const redirectTarget = new URL("/pages/", context.request.url).toString();
  const body = {
    ok: false,
    error: {
      code: "SUBPROJECT_REMOVED",
      message: "The AU Home Loan Rates subproject has been removed from OrderSkew.",
    },
    redirect_to: redirectTarget,
  };

  return new Response(JSON.stringify(body), {
    status: 410,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
