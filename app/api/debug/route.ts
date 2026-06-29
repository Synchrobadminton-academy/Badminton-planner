import { NextResponse } from "next/server";

const FIREBASE_URL = (
  process.env.FIREBASE_URL ||
  "https://synchroadmin-133f3-default-rtdb.asia-southeast1.firebasedatabase.app"
).replace(/\/$/, "");

export async function GET() {
  return NextResponse.json({
    firebase_url: FIREBASE_URL,
    node_version: process.version,
    env: process.env.NODE_ENV,
  });
}
