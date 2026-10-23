import prisma from "../db.server";

export const loader = async () => {
  await prisma.$queryRaw`SELECT 1`;  // keeps Supabase alive
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};


// export const loader = () => {
//   return new Response("OK", { status: 200, headers: { "Content-Type": "text/plain" } });
// };
