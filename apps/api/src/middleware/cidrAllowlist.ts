import type { NextFunction, Request, Response } from "express";
import { env } from "../env.js";

// Stand-in for the ТЗ §6.5 "access only from the corporate network" requirement.
// A production deployment should replace this with real SSO/ZTNA/VPN posture
// checking as decided with the customer's IT/security team; this middleware
// approximates it with a configurable IPv4 CIDR allowlist so the requirement
// is enforced end-to-end even before that decision is made.

function ipToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr ?? 32);
  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function normalizeIp(raw: string | undefined): string {
  if (!raw) return "";
  // Strip IPv4-mapped IPv6 prefix (e.g. ::ffff:127.0.0.1) used by Node on some platforms.
  return raw.replace(/^::ffff:/, "");
}

export function cidrAllowlist(req: Request, res: Response, next: NextFunction) {
  if (env.allowedCidrs.length === 0) {
    // No restriction configured (e.g. local dev) — allow everything.
    return next();
  }
  const clientIp = normalizeIp(req.ip);
  const allowed = env.allowedCidrs.some((cidr) => inCidr(clientIp, cidr));
  if (!allowed) {
    return res.status(403).json({
      error: "Доступ разрешён только с устройств корпоративной сети организации.",
    });
  }
  next();
}
