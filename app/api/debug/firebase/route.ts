import { NextResponse } from "next/server";

const FIREBASE_URL = (
  process.env.FIREBASE_URL ||
  "https://synchroadmin-133f3-default-rtdb.asia-southeast1.firebasedatabase.app"
).replace(/\/$/, "");

export async function GET() {
  try {
    const res = await fetch(`${FIREBASE_URL}/.json?shallow=true`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, status: res.status }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}
