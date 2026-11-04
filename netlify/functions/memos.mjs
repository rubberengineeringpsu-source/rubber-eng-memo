import { getStore } from "@netlify/blobs";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

const store = () => getStore({ name: "memos", consistency: "strong" });
const YY = /^\d{2}$/;

async function listYear(s, yy) {
  const { blobs } = await s.list({ prefix: `${yy}/` });
  const items = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
  return items.filter(Boolean);
}

function clean(record) {
  const r = record && typeof record === "object" ? record : {};
  return {
    date: String(r.date || "").slice(0, 10),
    project: String(r.project || "").slice(0, 500),
    dept: String(r.dept || "").slice(0, 200),
    total: Number(r.total) || 0,
    form: r.form && typeof r.form === "object" ? r.form : {},
  };
}

export default async (req) => {
  const s = store();
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      const yy = url.searchParams.get("yy") || "";
      if (yy === "all") {
        const { blobs } = await s.list();
        const items = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
        return json(items.filter(Boolean));
      }
      if (!YY.test(yy)) return json({ error: "ปีไม่ถูกต้อง" }, 400);
      return json(await listYear(s, yy));
    }
    const raw = await req.text();
    if (raw.length > 200000) return json({ error: "ข้อมูลยาวเกินไป" }, 413);
    const body = JSON.parse(raw || "{}");
    const yy = String(body.yy || "");
    if (!YY.test(yy)) return json({ error: "ปีไม่ถูกต้อง" }, 400);
    const rec = clean(body.record);

    if (req.method === "POST") {
      // Claim the next free number: each number is its own key, created only if it does not exist yet.
      const fixed = Number.isInteger(body.n) && body.n > 0;
      let n = fixed ? body.n : (await listYear(s, yy)).reduce((m, x) => Math.max(m, x.n || 0), 0) + 1;
      for (let tries = 0; tries < 30; tries++, n++) {
        const now = new Date().toISOString();
        const { modified } = await s.setJSON(`${yy}/${n}`, { ...rec, yy, n, createdAt: now, updatedAt: now }, { onlyIfNew: true });
        if (modified) return json({ n });
        if (fixed) return json({ error: `เลข ${yy}-${n} ถูกใช้ไปแล้ว ดูในทะเบียนด้านขวา` }, 409);
      }
      return json({ error: "จองเลขไม่สำเร็จ กรุณาลองใหม่" }, 503);
    }

    if (req.method === "PUT") {
      const n = Number(body.n);
      if (!Number.isInteger(n) || n < 1) return json({ error: "เลขไม่ถูกต้อง" }, 400);
      const key = `${yy}/${n}`;
      const existing = await s.get(key, { type: "json" });
      if (!existing) return json({ error: `ไม่พบหนังสือเลข ${yy}-${n}` }, 404);
      await s.setJSON(key, { ...existing, ...rec, yy, n, updatedAt: new Date().toISOString() });
      return json({ n });
    }
    return json({ error: "method not allowed" }, 405);
  } catch (e) {
    console.error(e);
    return json({ error: "เซิร์ฟเวอร์ผิดพลาด กรุณาลองใหม่" }, 500);
  }
};

export const config = { path: "/api/memos" };
