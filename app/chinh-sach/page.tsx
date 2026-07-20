import Link from "next/link";
import type { ReactNode } from "react";
import policyData from "./policies-data.json";

type PolicyRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

type PolicyBlock = {
  text: string;
  runs: PolicyRun[];
  style: string | null;
  listMarker: string | null;
  listLevel: number;
};

type PolicyDocument = {
  id: string;
  title: string;
  sourceFile: string;
  blocks: PolicyBlock[];
};

const policies = policyData as PolicyDocument[];

function FormattedRun({ run }: { run: PolicyRun }) {
  let content: ReactNode = run.text;

  if (run.underline) content = <u>{content}</u>;
  if (run.italic) content = <em>{content}</em>;
  if (run.bold) content = <strong>{content}</strong>;

  return <span style={{ whiteSpace: "pre-wrap" }}>{content}</span>;
}

function PolicyContent({ blocks }: { blocks: PolicyBlock[] }) {
  return (
    <div style={{ maxWidth: 850, color: "#444", fontSize: 16, lineHeight: 1.75 }}>
      {blocks.map((block, blockIndex) => {
        if (!block.text) {
          return <div key={blockIndex} aria-hidden="true" style={{ height: 12 }} />;
        }

        const content = block.runs.map((run, runIndex) => (
          <FormattedRun key={runIndex} run={run} />
        ));

        if (block.listMarker) {
          return (
            <div
              key={blockIndex}
              style={{
                display: "grid",
                gridTemplateColumns: "24px minmax(0, 1fr)",
                columnGap: 8,
                marginBottom: 8,
                paddingLeft: block.listLevel * 22,
              }}
            >
              <span aria-hidden="true">{block.listMarker}</span>
              <p style={{ margin: 0 }}>{content}</p>
            </div>
          );
        }

        return (
          <p key={blockIndex} style={{ margin: "0 0 12px" }}>
            {content}
          </p>
        );
      })}
    </div>
  );
}

export default function PolicyPage() {
  return <main style={{ maxWidth: 1080, margin: "0 auto", padding: "40px 22px 80px", fontFamily: "Arial, sans-serif", color: "#111" }}>
    <Link href="/" style={{ color: "#111", textDecoration: "none", fontSize: 13 }}>← TRỞ VỀ WEBSITE</Link>
    <header style={{ borderBottom: "2px solid #111", padding: "42px 0 28px" }}>
      <p style={{ margin: 0, textTransform: "uppercase", letterSpacing: ".12em", fontSize: 12 }}>BLANWHI – BNW</p>
      <h1 style={{ margin: "12px 0 0", fontSize: "clamp(34px,7vw,72px)", lineHeight: 1 }}>Chính sách hoạt động của website</h1>
    </header>
    <nav aria-label="Danh mục chính sách" style={{ display: "grid", gap: 8, padding: "24px 0", borderBottom: "1px solid #ccc" }}>
      {policies.map((item) => <a key={item.id} href={"#" + item.id} style={{ color: "#111", lineHeight: 1.5 }}>{item.title}</a>)}
    </nav>
    {policies.map((item) => <section key={item.id} id={item.id} style={{ scrollMarginTop: 24, padding: "34px 0", borderBottom: "1px solid #ddd" }}>
      <h2 style={{ margin: "0 0 14px", fontSize: "clamp(22px,4vw,34px)", lineHeight: 1.2 }}>{item.title}</h2>
      <PolicyContent blocks={item.blocks} />
    </section>)}
    <section style={{ marginTop: 38, padding: 24, background: "#f4f4f2", lineHeight: 1.7 }}>
      <strong>HỘ KINH DOANH BLANWHI – BNW</strong><br />
      Địa chỉ: 282/49, Phường Gia Định, Thành phố Hồ Chí Minh<br />
      Mã số HKD: 079093030935 do UBND Quận Bình Thạnh cấp ngày 16/09/2022<br />
      Chủ hộ kinh doanh: Nguyễn Việt Thắng<br />Hotline: <a href="tel:0866561480">0866561480</a>
    </section>
  </main>;
}
