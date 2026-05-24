/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  isLocalHostname,
  isLocalIpv4,
  isLocalIpv6,
  normalizeLocalHttpUrl,
  parseIpv6,
} from "./localUrl";

describe("isLocalIpv4", () => {
  it("accepts loopback, RFC 1918 and link-local ranges", () => {
    expect(isLocalIpv4("127.0.0.1")).toBe(true);
    expect(isLocalIpv4("127.255.255.254")).toBe(true);
    expect(isLocalIpv4("10.0.0.1")).toBe(true);
    expect(isLocalIpv4("10.255.255.255")).toBe(true);
    expect(isLocalIpv4("192.168.1.1")).toBe(true);
    expect(isLocalIpv4("172.16.0.1")).toBe(true);
    expect(isLocalIpv4("172.31.255.255")).toBe(true);
    expect(isLocalIpv4("169.254.1.1")).toBe(true);
  });

  it("rejects public, broadcast, and out-of-range addresses", () => {
    expect(isLocalIpv4("8.8.8.8")).toBe(false);
    expect(isLocalIpv4("172.15.255.255")).toBe(false);
    expect(isLocalIpv4("172.32.0.1")).toBe(false);
    expect(isLocalIpv4("0.0.0.0")).toBe(false);
    expect(isLocalIpv4("255.255.255.255")).toBe(false);
    expect(isLocalIpv4("192.169.1.1")).toBe(false);
    expect(isLocalIpv4("169.253.1.1")).toBe(false);
  });

  it("rejects leading zeros and other malformed octets", () => {
    expect(isLocalIpv4("010.0.0.1")).toBe(false);
    expect(isLocalIpv4("127.0.0.01")).toBe(false);
    expect(isLocalIpv4("1.2.3")).toBe(false);
    expect(isLocalIpv4("1.2.3.4.5")).toBe(false);
    expect(isLocalIpv4("127.0.0.256")).toBe(false);
    expect(isLocalIpv4("127.0.0.-1")).toBe(false);
    expect(isLocalIpv4("")).toBe(false);
    expect(isLocalIpv4("127.0.0.a")).toBe(false);
  });
});

describe("parseIpv6", () => {
  it("expands :: shorthand correctly", () => {
    const bytes = parseIpv6("::1");
    expect(bytes).not.toBeNull();
    expect(bytes![15]).toBe(1);
    for (let i = 0; i < 15; i++) expect(bytes![i]).toBe(0);
  });

  it("parses IPv4-mapped forms", () => {
    const bytes = parseIpv6("::ffff:127.0.0.1");
    expect(bytes).not.toBeNull();
    expect(bytes![10]).toBe(0xff);
    expect(bytes![11]).toBe(0xff);
    expect(bytes![12]).toBe(127);
    expect(bytes![15]).toBe(1);
  });

  it("rejects zone identifiers", () => {
    expect(parseIpv6("fe80::1%eth0")).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(parseIpv6("fcZZ::1")).toBeNull();
    expect(parseIpv6("1::2::3")).toBeNull();
    expect(parseIpv6("")).toBeNull();
    expect(parseIpv6("12345::1")).toBeNull();
    expect(parseIpv6("::ffff:127.0.0.1.2")).toBeNull();
  });
});

describe("isLocalIpv6", () => {
  it("accepts ::1, ULA, link-local, and IPv4-mapped local addresses", () => {
    expect(isLocalIpv6("::1")).toBe(true);
    expect(isLocalIpv6("fc00::1")).toBe(true);
    expect(isLocalIpv6("fd12:3456:789a::1")).toBe(true);
    expect(isLocalIpv6("fe80::1")).toBe(true);
    expect(isLocalIpv6("::ffff:127.0.0.1")).toBe(true);
    expect(isLocalIpv6("::ffff:10.0.0.1")).toBe(true);
  });

  it("rejects public IPv6 and lookalike addresses", () => {
    // `feed::1` is the classic regression case for prefix-based heuristics:
    // string starts with "fe" but is not in fe80::/10.
    expect(isLocalIpv6("feed::1")).toBe(false);
    expect(isLocalIpv6("2001:db8::1")).toBe(false);
    expect(isLocalIpv6("::ffff:8.8.8.8")).toBe(false);
    expect(isLocalIpv6("fec0::1")).toBe(false);
    expect(isLocalIpv6("fbff::1")).toBe(false);
  });
});

describe("isLocalHostname", () => {
  it("accepts only the bare literal `localhost`", () => {
    expect(isLocalHostname("localhost")).toBe(true);
    expect(isLocalHostname("LOCALHOST")).toBe(true);
  });

  it("rejects *.localhost — closes the DNS-rebind bypass", () => {
    // This is the regression test for the security finding that motivated
    // this module: `attacker.localhost` was previously accepted by the
    // string-suffix heuristic.
    expect(isLocalHostname("attacker.localhost")).toBe(false);
    expect(isLocalHostname("foo.bar.localhost")).toBe(false);
  });

  it("rejects names that contain `localhost` as a substring", () => {
    expect(isLocalHostname("localhost.attacker.com")).toBe(false);
    expect(isLocalHostname("notlocalhost")).toBe(false);
  });

  it("rejects IDN, underscores, and percent-encoded forms", () => {
    expect(isLocalHostname("xn--nxasmq6b")).toBe(false);
    expect(isLocalHostname("foo_bar")).toBe(false);
    expect(isLocalHostname("127%2e0%2e0%2e1")).toBe(false);
  });

  it("accepts IPv4 literals in allowed ranges", () => {
    expect(isLocalHostname("127.0.0.1")).toBe(true);
    expect(isLocalHostname("10.0.0.1")).toBe(true);
    expect(isLocalHostname("192.168.1.1")).toBe(true);
  });

  it("accepts unbracketed IPv6 literals in allowed ranges", () => {
    expect(isLocalHostname("::1")).toBe(true);
    expect(isLocalHostname("fc00::1")).toBe(true);
    expect(isLocalHostname("fe80::1")).toBe(true);
  });
});

describe("normalizeLocalHttpUrl — accepts (exact-output cases)", () => {
  // These cases assert exact canonical output. Hostnames here are already in
  // WHATWG-canonical form so the round-trip is stable across runtimes.
  const accepted: Array<[string, string]> = [
    ["http://localhost:8080", "http://localhost:8080"],
    ["http://localhost/", "http://localhost"],
    ["http://127.0.0.1", "http://127.0.0.1"],
    ["http://10.0.0.1", "http://10.0.0.1"],
    ["http://192.168.1.1", "http://192.168.1.1"],
    ["http://172.16.0.1", "http://172.16.0.1"],
    ["http://172.31.255.255", "http://172.31.255.255"],
    ["http://169.254.1.1", "http://169.254.1.1"],
    ["http://[::1]/", "http://[::1]"],
    ["http://[fc00::1]/", "http://[fc00::1]"],
    ["http://[fe80::1]/", "http://[fe80::1]"],
    ["https://localhost:8443/", "https://localhost:8443"],
  ];
  for (const [input, expected] of accepted) {
    it(`accepts ${input}`, () => {
      expect(normalizeLocalHttpUrl(input, "TestProvider")).toBe(expected);
    });
  }
});

describe("normalizeLocalHttpUrl — accepts (acceptance-only)", () => {
  // These cases assert acceptance but not exact output, because the WHATWG
  // URL parser canonicalises IPv6 in runtime-specific ways (e.g. case folding,
  // converting `::ffff:127.0.0.1` to `::ffff:7f00:1`, or compressing zero
  // runs). The contract under test here is "this is recognised as local".
  const accepted = [
    "http://[FCAF:FE::1]/",
    "http://[fd12:3456:789a::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:10.0.0.1]/",
  ];
  for (const input of accepted) {
    it(`accepts ${input}`, () => {
      expect(() => normalizeLocalHttpUrl(input, "TestProvider")).not.toThrow();
    });
  }
});

describe("normalizeLocalHttpUrl — rejects", () => {
  const rejected: string[] = [
    "http://attacker.localhost/",
    "http://localhost.attacker.com/",
    "http://[feed::1]/",
    "http://[fcZZ::1]/",
    "http://[2001:db8::1]/",
    "http://[fe80::1%eth0]/",
    "http://172.32.0.1/",
    "http://172.15.255.255/",
    "http://8.8.8.8/",
    "http://0.0.0.0/",
    "http://255.255.255.255/",
    "http://010.0.0.1/",
    "http://1.2.3/",
    "ftp://localhost/",
    "ws://localhost/",
    "file:///etc/passwd",
    "http://user:pw@localhost/",
    "not-a-url",
  ];
  for (const input of rejected) {
    it(`rejects ${input}`, () => {
      expect(() => normalizeLocalHttpUrl(input, "TestProvider")).toThrow();
    });
  }
});

describe("normalizeLocalHttpUrl — canonicalisation", () => {
  it("strips query, hash, and trailing slashes from the path", () => {
    expect(normalizeLocalHttpUrl("http://localhost/v1/?x=1#y", "TestProvider")).toBe(
      "http://localhost/v1"
    );
  });

  it("collapses a bare '/' path to the origin", () => {
    expect(normalizeLocalHttpUrl("http://localhost:9090/", "TestProvider")).toBe(
      "http://localhost:9090"
    );
  });

  it("preserves case in the path while lowercasing the hostname", () => {
    expect(normalizeLocalHttpUrl("http://LocalHost/CasePath", "TestProvider")).toBe(
      "http://localhost/CasePath"
    );
  });

  it("strips multiple trailing slashes from the path", () => {
    expect(normalizeLocalHttpUrl("http://localhost/v1///", "TestProvider")).toBe(
      "http://localhost/v1"
    );
  });
});

describe("normalizeLocalHttpUrl — error labels", () => {
  it("includes the provider label in errors for non-local hosts", () => {
    expect(() => normalizeLocalHttpUrl("http://attacker.localhost/", "LlamaCppServer")).toThrow(
      /LlamaCppServer/
    );
    expect(() =>
      normalizeLocalHttpUrl("http://attacker.localhost/", "StableDiffusionCpp")
    ).toThrow(/StableDiffusionCpp/);
  });

  it("includes the provider label in errors for invalid URLs", () => {
    expect(() => normalizeLocalHttpUrl("not-a-url", "LlamaCppServer")).toThrow(/LlamaCppServer/);
  });

  it("includes the provider label in errors for credentialed URLs", () => {
    expect(() => normalizeLocalHttpUrl("http://user:pw@localhost/", "LlamaCppServer")).toThrow(
      /LlamaCppServer/
    );
  });
});
