import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeVerifierLlm } from "./provider";

const KEYS = ["AI_API_KEY", "OPENAI_API_KEY", "LOVABLE_API_KEY", "AI_MODEL_ACCURATE", "AI_MODEL_ADVANCED", "VERIFY_MODEL", "AI_BASE_URL"];
let saved: Record<string, string | undefined> = {};
let realFetch: typeof fetch;
let sent: { url: string; model: string }[] = [];

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  sent = [];
  realFetch = globalThis.fetch;
  (globalThis as any).fetch = async (url: string, init: any) => {
    sent.push({ url, model: JSON.parse(init.body).model });
    return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
  };
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  (globalThis as any).fetch = realFetch;
});

const call = (llm: NonNullable<ReturnType<typeof makeVerifierLlm>>, role: "extract" | "solve" | "compare" | "reread" | "method") =>
  llm({ role, system: "s", user: "u", maxTokens: 100 });

describe("makeVerifierLlm", () => {
  it("بلا أي مفتاح: لا محقِّق", () => expect(makeVerifierLlm("fast")).toBeNull());

  it("مفتاح OpenAI: الحل المستقل بنموذج OpenAI حين يجيب Gemini، والاستخراج بـ accurate", async () => {
    process.env["AI_API_KEY"] = "g"; process.env["OPENAI_API_KEY"] = "o"; process.env["AI_MODEL_ACCURATE"] = "gemini-x";
    const llm = makeVerifierLlm("accurate")!;
    await call(llm, "extract"); await call(llm, "solve"); await call(llm, "compare");
    expect(sent.map((s) => s.model)).toEqual(["gemini-x", "gpt-5", "gpt-5"]);
    expect(sent[1].url).toContain("openai.com");
  });

  it("حين يجيب نموذج advanced يُحكَّم نموذج accurate كي لا يراجع نفسه", async () => {
    process.env["AI_API_KEY"] = "g"; process.env["OPENAI_API_KEY"] = "o"; process.env["AI_MODEL_ACCURATE"] = "gemini-x";
    const llm = makeVerifierLlm("advanced")!;
    await call(llm, "solve");
    expect(sent[0].model).toBe("gemini-x");
    expect(sent[0].url).not.toContain("openai.com");
  });

  it("إعادة قراءة الصورة بنموذج advanced دائماً (القراءة الأولى بـ accurate)، والمنهج مع الحَكَم", async () => {
    process.env["AI_API_KEY"] = "g"; process.env["OPENAI_API_KEY"] = "o"; process.env["AI_MODEL_ACCURATE"] = "gemini-x";
    const llm = makeVerifierLlm("advanced")!;
    await call(llm, "reread"); await call(llm, "method");
    expect(sent.map((s) => s.model)).toEqual(["gpt-5", "gemini-x"]);
  });

  it("VERIFY_MODEL يفرض الاسم", async () => {
    process.env["AI_API_KEY"] = "g"; process.env["VERIFY_MODEL"] = "my-verifier";
    const llm = makeVerifierLlm("fast")!;
    await call(llm, "extract"); await call(llm, "compare");
    expect(sent.map((s) => s.model)).toEqual(["my-verifier", "my-verifier"]);
  });

  it("فشل الشبكة يعطي null ولا يرمي", async () => {
    process.env["AI_API_KEY"] = "g";
    (globalThis as any).fetch = async () => { throw new Error("offline"); };
    expect(await call(makeVerifierLlm("fast")!, "extract")).toBeNull();
    (globalThis as any).fetch = async () => new Response("no", { status: 500 });
    expect(await call(makeVerifierLlm("fast")!, "extract")).toBeNull();
  });
});
