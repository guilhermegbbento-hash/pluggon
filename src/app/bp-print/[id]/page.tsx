"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ---------- Types ----------

interface BPSection {
  number: number;
  title: string;
  content: string;
}

interface BPData {
  client_name: string;
  city: string;
  state: string;
  capital_available: string;
  content_json: {
    sections: BPSection[];
    ibge: {
      population: number | null;
      gdp_per_capita: number | null;
      idhm: number | null;
    };
    chargers_count: number;
  };
}

// ---------- Markdown to HTML ----------

function inlineFmt(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const parts: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("### ")) {
      parts.push(`<h4 class="bp-h4">${inlineFmt(line.slice(4))}</h4>`);
      i++; continue;
    }
    if (line.startsWith("## ")) {
      parts.push(`<h3 class="bp-h3">${inlineFmt(line.slice(3))}</h3>`);
      i++; continue;
    }
    if (line.startsWith("# ")) {
      parts.push(`<h2 class="bp-section-title">${inlineFmt(line.slice(2))}</h2>`);
      i++; continue;
    }

    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      parts.push(`<blockquote class="bp-blockquote">${quoteLines.map(l => inlineFmt(l)).join("<br/>")}</blockquote>`);
      continue;
    }

    if (line.includes("|") && line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const dataRows = tableLines.filter((l) => !l.match(/^\|\s*[-:]+[-|:\s]*$/));
      const parseCells = (l: string) => l.split("|").filter((c) => c.trim() !== "").map((c) => c.trim());

      if (dataRows.length > 0) {
        const headerCells = parseCells(dataRows[0]);
        const hasSeparator = tableLines.length > 1 && !!tableLines[1].match(/^\|\s*[-:]+[-|:\s]*$/);

        let table = '<table>';
        if (hasSeparator) {
          table += "<thead><tr>";
          for (const cell of headerCells) {
            table += `<th>${inlineFmt(cell)}</th>`;
          }
          table += "</tr></thead><tbody>";
          for (let r = 1; r < dataRows.length; r++) {
            const cells = parseCells(dataRows[r]);
            const rowContent = cells.map(c => c.toLowerCase());
            const isTotal = rowContent.some(c => c.includes("total") || c.includes("payback") || c.includes("roi"));
            table += `<tr class="${isTotal ? 'total-row' : ''}">`;
            for (const cell of cells) {
              const isMonetary = /R\$|%|\d{1,3}(\.\d{3})+/.test(cell);
              table += `<td${isMonetary ? ' style="text-align:right;font-variant-numeric:tabular-nums"' : ''}>${inlineFmt(cell)}</td>`;
            }
            table += "</tr>";
          }
          table += "</tbody>";
        } else {
          table += "<tbody>";
          for (let r = 0; r < dataRows.length; r++) {
            const cells = parseCells(dataRows[r]);
            table += "<tr>";
            for (const cell of cells) {
              const isMonetary = /R\$|%|\d{1,3}(\.\d{3})+/.test(cell);
              table += `<td${isMonetary ? ' style="text-align:right;font-variant-numeric:tabular-nums"' : ''}>${inlineFmt(cell)}</td>`;
            }
            table += "</tr>";
          }
          table += "</tbody>";
        }
        table += "</table>";
        parts.push(table);
      }
      continue;
    }

    if (line.match(/^\s*[-*]\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\s*[-*]\s/)) {
        items.push(lines[i].replace(/^\s*[-*]\s/, ""));
        i++;
      }
      parts.push('<div class="bp-list">');
      for (const item of items) {
        parts.push(`<div class="bp-list-item"><span class="bp-dash">&mdash;</span> ${inlineFmt(item)}</div>`);
      }
      parts.push("</div>");
      continue;
    }

    if (line.match(/^\s*\d+\.\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\s*\d+\.\s/)) {
        items.push(lines[i].replace(/^\s*\d+\.\s/, ""));
        i++;
      }
      parts.push('<ol class="bp-ol">');
      for (const item of items) {
        parts.push(`<li>${inlineFmt(item)}</li>`);
      }
      parts.push("</ol>");
      continue;
    }

    if (line.trim() === "") {
      while (i < lines.length && lines[i].trim() === "") i++;
      continue;
    }

    if (line.trim().startsWith('"') && line.trim().endsWith('"')) {
      parts.push(`<blockquote class="bp-blockquote">${inlineFmt(line.trim().slice(1, -1))}</blockquote>`);
      i++; continue;
    }

    parts.push(`<p>${inlineFmt(line)}</p>`);
    i++;
  }

  return parts.join("\n");
}

// ---------- Sections that get page-break-before ----------

const BREAK_BEFORE_KEYWORDS = [
  "QUEM SOMOS",
  "SUMÁRIO",
  "ANÁLISE DE MERCADO",
  "INVESTIMENTO INICIAL",
  "PROJEÇÃO FINANCEIRA",
  "MARKETING",
  "PROJEÇÃO DE 5 ANOS",
  "PLANO DE AÇÃO",
  "DISCLAIMER",
];

function shouldBreakBefore(title: string): boolean {
  const upper = title.toUpperCase();
  return BREAK_BEFORE_KEYWORDS.some(kw => upper.includes(kw));
}

// ---------- Extract config from capa ----------

function extractConfig(sections: BPSection[]): { config: string; investimento: string } {
  const capa = sections.find(s => s.number === 1);
  if (!capa) return { config: "", investimento: "" };
  const configMatch = capa.content.match(/Configura[çc][aã]o[^:]*:\s*(.+)/i);
  const investMatch = capa.content.match(/Investimento[^:]*:\s*(R\$\s*[\d.,]+)/i);
  return {
    config: configMatch?.[1]?.trim() || "",
    investimento: investMatch?.[1]?.trim() || "",
  };
}

// ---------- Component ----------

export default function BPPrintPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<BPData | null>(null);
  const [error, setError] = useState("");
  const [printed, setPrinted] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: bp, error: err } = await supabase
        .from("business_plans")
        .select("client_name, city, state, capital_available, content_json")
        .eq("id", id)
        .single();

      if (err || !bp) {
        setError("Business Plan não encontrado.");
        return;
      }
      setData(bp as BPData);
    }
    load();
  }, [id]);

  // Auto-print after render
  useEffect(() => {
    if (!data || printed) return;
    const timer = setTimeout(() => {
      setPrinted(true);
      window.print();
    }, 800);
    return () => clearTimeout(timer);
  }, [data, printed]);

  if (error) {
    return (
      <div style={{ padding: 40, fontFamily: "Georgia, serif" }}>
        <p style={{ color: "red" }}>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 40, fontFamily: "Georgia, serif", textAlign: "center" }}>
        <p>Carregando Business Plan...</p>
      </div>
    );
  }

  const { sections } = data.content_json;
  const today = new Date();
  const dateStr = today.toLocaleDateString("pt-BR", {
    day: "2-digit", month: "long", year: "numeric",
  });
  const dateFormatted = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
  const { config, investimento } = extractConfig(sections);

  // Filter out empty/short sections (skip capa = section 1)
  const contentSections = sections
    .filter((s) => s.number !== 1)
    .filter((s) => s.content && s.content.trim().length > 10);

  return (
    <>
      <style jsx global>{`
        /* ========== BASE ========== */
        body {
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 12px;
          line-height: 1.9;
          color: #2c2c2c;
          background: white;
          margin: 0;
          padding: 0;
        }

        /* ========== COVER PAGE ========== */
        .page-capa {
          height: 100vh;
          background: #0A0A0A;
          color: white;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          text-align: center;
          page-break-after: always;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .capa-label {
          font-size: 16px;
          letter-spacing: 12px;
          color: #C9A84C;
          text-transform: uppercase;
          font-family: 'Helvetica Neue', Arial, sans-serif;
        }
        .capa-line {
          width: 100px;
          height: 2px;
          background: #C9A84C;
          margin: 50px auto;
          border: none;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .capa-city {
          font-size: 36px;
          font-weight: 800;
          color: white;
          font-family: 'Helvetica Neue', Arial, sans-serif;
          margin-bottom: 12px;
        }
        .capa-state {
          font-size: 28px;
          color: white;
          font-family: 'Helvetica Neue', Arial, sans-serif;
        }
        .capa-for { font-size: 12px; color: #888; }
        .capa-name {
          font-size: 22px;
          font-weight: 600;
          color: white;
          font-family: 'Helvetica Neue', Arial, sans-serif;
          margin-top: 40px;
        }
        .capa-date { font-size: 12px; color: #666; }
        .capa-box {
          border: 1px solid #C9A84C;
          padding: 24px 36px;
          display: inline-block;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .capa-box-text {
          font-size: 14px;
          color: #C9A84C;
          font-family: 'Helvetica Neue', Arial, sans-serif;
        }
        .capa-footer { font-size: 10px; color: #555; }

        /* ========== SECTION CONTAINERS ========== */
        .section-with-break {
          padding: 30mm 25mm 30mm 25mm;
          page-break-before: always;
        }
        .section-no-break {
          padding: 10mm 25mm;
        }

        /* ========== TYPOGRAPHY ========== */
        h2, .bp-section-title {
          font-family: 'Helvetica Neue', Arial, sans-serif;
          font-size: 22px;
          font-weight: 700;
          color: #C9A84C;
          border-bottom: 3px solid #C9A84C;
          padding-bottom: 10px;
          margin-bottom: 20px;
          margin-top: 40px;
          line-height: 1.3;
          page-break-after: avoid;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .bp-h3 {
          font-size: 16px;
          font-weight: 600;
          color: #333;
          margin-top: 25px;
          margin-bottom: 12px;
          font-family: 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.4;
          page-break-after: avoid;
        }
        .bp-h4 {
          font-size: 14px;
          font-weight: 600;
          color: #333;
          margin-top: 20px;
          margin-bottom: 10px;
          font-family: 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.4;
          page-break-after: avoid;
        }
        p {
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 12px;
          line-height: 1.9;
          color: #2c2c2c;
          margin-bottom: 14px;
          text-align: justify;
          orphans: 3;
          widows: 3;
        }
        strong { font-weight: 700; color: #1a1a1a; }

        /* ========== TABLES ========== */
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 25px 0 30px 0;
          page-break-inside: avoid;
        }
        th {
          background: #C9A84C !important;
          color: white !important;
          padding: 12px 15px;
          text-align: left;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-family: 'Helvetica Neue', Arial, sans-serif;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        td {
          padding: 12px 15px;
          font-size: 11px;
          line-height: 1.5;
          border-bottom: 1px solid #eee;
        }
        tr:nth-child(even) td {
          background: #fafafa !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .total-row {
          font-weight: 700;
          background: #f0ebe0 !important;
          border-top: 2px solid #C9A84C;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .total-row td {
          font-weight: 700;
          border-top: 2px solid #C9A84C;
        }

        /* ========== LISTS ========== */
        .bp-list {
          margin: 12px 0 20px 0;
          padding-left: 20px;
        }
        .bp-list-item {
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 12px;
          line-height: 1.7;
          color: #2c2c2c;
          margin-bottom: 8px;
          padding-left: 20px;
          text-indent: -20px;
        }
        .bp-dash {
          color: #C9A84C;
          font-weight: 700;
          margin-right: 8px;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .bp-ol {
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 12px;
          line-height: 1.7;
          color: #2c2c2c;
          padding-left: 24px;
          margin: 12px 0 20px 0;
        }
        .bp-ol li { margin-bottom: 8px; }

        /* ========== BLOCKQUOTE / DESTAQUE ========== */
        .bp-blockquote, .destaque {
          background: #f8f5ed !important;
          border-left: 4px solid #C9A84C;
          padding: 15px 20px;
          margin: 15px 0;
          font-style: italic;
          color: #444;
          border-radius: 0 4px 4px 0;
          page-break-inside: avoid;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        /* ========== HEADER/FOOTER ========== */
        .bp-header {
          display: flex;
          justify-content: space-between;
          font-size: 8px;
          color: #bbb;
          border-bottom: 0.5px solid #e0e0e0;
          padding-bottom: 8px;
          margin-bottom: 25px;
          font-family: 'Helvetica Neue', Arial, sans-serif;
        }
        .bp-footer {
          display: flex;
          justify-content: space-between;
          font-size: 8px;
          color: #bbb;
          border-top: 0.5px solid #e0e0e0;
          padding-top: 8px;
          margin-top: 25px;
          font-family: 'Helvetica Neue', Arial, sans-serif;
        }

        /* ========== SCREEN PREVIEW ========== */
        @media screen {
          body { background: #e8e8e8; padding: 20px; }
          .bp-doc {
            max-width: 210mm;
            margin: 0 auto;
            background: white;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
          }
          .no-print {
            display: flex;
            justify-content: center;
            gap: 12px;
            padding: 20px;
            position: sticky;
            top: 0;
            background: #e8e8e8;
            z-index: 10;
          }
          .no-print button {
            padding: 12px 28px;
            font-size: 14px;
            font-weight: 600;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: opacity 0.2s;
          }
          .no-print button:hover { opacity: 0.85; }
          .btn-print { background: #C9A84C; color: #0D1117; }
          .btn-back { background: #30363D; color: white; }
        }

        /* ========== PRINT ========== */
        @media print {
          @page { size: A4; margin: 25mm 20mm 25mm 25mm; }
          @page :first { margin: 0; }
          body {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print { display: none !important; }
          .page-capa {
            height: 100vh;
            margin: 0;
            padding: 0;
          }
          .section-with-break {
            padding: 0;
            page-break-before: always;
          }
          .section-no-break {
            padding: 0;
          }
          p { orphans: 3; widows: 3; }
          h2, h3, h4, .bp-section-title, .bp-h3, .bp-h4 {
            page-break-after: avoid;
          }
          table, .bp-blockquote, .destaque { page-break-inside: avoid; }
        }

        /* ========== AVOID ORPHANS ========== */
        h2, h3, h4, .bp-section-title, .bp-h3, .bp-h4 {
          page-break-after: avoid;
        }
        table { page-break-inside: avoid; }
      `}</style>

      <div className="no-print">
        <button className="btn-print" onClick={() => window.print()}>
          Imprimir / Salvar PDF
        </button>
        <button className="btn-back" onClick={() => window.close()}>
          Fechar
        </button>
      </div>

      <div className="bp-doc">
        {/* ===== CAPA ===== */}
        <div className="page-capa">
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div className="capa-label">Business Plan</div>
            <div className="capa-label" style={{ marginTop: 4 }}>Personalizado</div>
            <div className="capa-line" />
            <div className="capa-city">ELETROPOSTO</div>
            <div className="capa-state">{data.city.toUpperCase()}/{data.state.toUpperCase()}</div>

            <div style={{ height: 60 }} />

            <div className="capa-for">Preparado para:</div>
            <div className="capa-name" style={{ marginTop: 6 }}>{data.client_name}</div>
            <div className="capa-date" style={{ marginTop: 8 }}>{dateFormatted}</div>

            <div style={{ height: 40 }} />

            {(config || investimento) && (
              <div className="capa-box">
                {config && <div className="capa-box-text">{config}</div>}
                {investimento && <div className="capa-box-text" style={{ marginTop: config ? 6 : 0 }}>Investimento: {investimento}</div>}
              </div>
            )}
          </div>
          <div className="capa-footer">BLEV Educação</div>
        </div>

        {/* ===== CONTENT SECTIONS ===== */}
        {contentSections.map((section) => {
          const useBreak = shouldBreakBefore(section.title);
          const sectionClass = useBreak ? "section-with-break" : "section-no-break";

          return (
            <div key={section.number} className={sectionClass}>
              {useBreak && (
                <div className="bp-header">
                  <span>PLUGGON by BLEV Educação</span>
                  <span>Business Plan — {data.client_name}</span>
                </div>
              )}

              <h2 className="bp-section-title">{section.title}</h2>
              <div dangerouslySetInnerHTML={{ __html: markdownToHtml(section.content) }} />

              {useBreak && (
                <div className="bp-footer">
                  <span>@guilhermegbbento</span>
                  <span>BLEV Educação</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
