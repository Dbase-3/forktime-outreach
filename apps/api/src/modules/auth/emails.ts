// Lisna's emails, in the product's own look (owner 2026-11-27): the ℓ tile and
// wordmark, monochrome, hairline borders, rounded card, small mono upper-case
// labels. Tables and inline styles only (what every email app renders), a
// hidden preheader, and a plain-text version of each. The logo is a PNG served
// by the web app (apps/platform/public/email/lisna-logo.png): Gmail won't show SVG.
// Anything a person typed (names, workspaces) is escaped.

// The app's light theme (apps/platform/app/globals.css), as hex.
const C = { page: "#f7f7f8", card: "#ffffff", line: "#e9e9ec", fg: "#0a0a0b", fg2: "#333339", fg3: "#505056", fg4: "#6b6b71", subtle: "#f7f7f8" };
const SANS = `Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`;
const MONO = `"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

export interface Email {
  subject: string;
  html: string;
  text: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function layout(o: { appUrl: string; preheader: string; label: string; title: string; body: string; to: string }): string {
  const logo = `${o.appUrl.replace(/\/$/, "")}/email/lisna-logo.png`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(o.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@500&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(o.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
  <tr><td align="center" style="padding:40px 16px;">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;">
      <tr><td style="padding:0 4px 24px;">
        <img src="${logo}" width="88" height="32" alt="lisna" style="display:block;border:0;outline:none;width:88px;height:32px;">
      </td></tr>
      <tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:16px;padding:32px;">
        <p style="margin:0 0 12px;font-family:${MONO};font-size:11px;line-height:16px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:${C.fg4};">${esc(o.label)}</p>
        <h1 style="margin:0 0 10px;font-family:${SANS};font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.02em;color:${C.fg};">${esc(o.title)}</h1>
        ${o.body}
      </td></tr>
      <tr><td style="padding:24px 4px 0;font-family:${SANS};font-size:12px;line-height:18px;color:${C.fg4};">
        Lisna &middot; AI phone agents that answer and call for your business.<br>
        Sent to ${esc(o.to)}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

const p = (html: string, extra = "") => `<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:24px;color:${C.fg2};${extra}">${html}</p>`;
const small = (html: string) => `<p style="margin:0;font-family:${SANS};font-size:13px;line-height:20px;color:${C.fg3};">${html}</p>`;

export function codeEmail(o: { code: string; to: string; appUrl: string }): Email {
  const spaced = `${o.code.slice(0, 3)}&thinsp;&thinsp;${o.code.slice(3)}`;
  const body = [
    p("Enter this code on the sign-in page to continue to Lisna."),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr>
      <td align="center" style="background:${C.subtle};border:1px solid ${C.line};border-radius:12px;padding:18px 12px;font-family:${MONO};font-size:34px;line-height:40px;font-weight:500;letter-spacing:0.18em;color:${C.fg};">${spaced}</td>
    </tr></table>`,
    small("It works for 10 minutes. If you didn&rsquo;t ask for it, you can ignore this email: nobody can sign in without it."),
  ].join("\n");
  return {
    subject: `${o.code} is your Lisna sign-in code`,
    html: layout({ appUrl: o.appUrl, preheader: `${o.code} is your sign-in code. It works for 10 minutes.`, label: "Sign-in code", title: "Your code is ready", body, to: o.to }),
    text: `Your Lisna sign-in code is ${o.code}.\n\nIt works for 10 minutes. If you didn't ask for it, you can ignore this email.\n\nLisna · AI phone agents that answer and call for your business.`,
  };
}

export function inviteEmail(o: { to: string; workspace: string; inviter: string; appUrl: string }): Email {
  const url = `${o.appUrl.replace(/\/$/, "")}/sign-in`;
  const body = [
    p(`${esc(o.inviter)} added you to <strong style="color:${C.fg};font-weight:600;">${esc(o.workspace)}</strong> on Lisna, to build and run its AI phone agents together.`),
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr>
      <td style="background:${C.fg};border-radius:10px;"><a href="${url}" style="display:inline-block;padding:12px 20px;font-family:${SANS};font-size:14px;line-height:20px;font-weight:500;color:#ffffff;text-decoration:none;">Join ${esc(o.workspace)}</a></td>
    </tr></table>`,
    small(`Sign in with this email address (${esc(o.to)}) and you&rsquo;ll be in. No password needed.`),
  ].join("\n");
  return {
    subject: `${o.inviter} invited you to ${o.workspace} on Lisna`,
    html: layout({ appUrl: o.appUrl, preheader: `Join ${o.workspace} on Lisna.`, label: "Invitation", title: `Join ${o.workspace}`, body, to: o.to }),
    text: `${o.inviter} invited you to ${o.workspace} on Lisna.\n\nSign in with this email address to join: ${url}\n\nLisna · AI phone agents that answer and call for your business.`,
  };
}
