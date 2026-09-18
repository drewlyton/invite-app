import { Resend } from "resend";
import { buildIcsAttachment, type EventForIcs } from "./ics.js";

export interface RsvpEmailInput {
	to: string;
	name: string;
	event: EventForIcs;
	eventUrl: string;
	partySize: number;
	dietary?: string;
	notes?: string;
}

let cachedClient: Resend | null = null;

function getClient(): Resend {
	if (cachedClient) return cachedClient;
	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey) {
		throw new Error(
			"RESEND_API_KEY must be set to send RSVP emails. " +
				"See .env.example for setup instructions.",
		);
	}
	cachedClient = new Resend(apiKey);
	return cachedClient;
}

function getFrom(): string {
	const email = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
	const name = process.env.RESEND_FROM_NAME ?? "Invites";
	return `${name} <${email}>`;
}

/**
 * HTML-escape user-supplied strings before dropping them into the email body.
 * Defensive — the form values are server-side validated as well, but
 * belt-and-suspenders.
 */
function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function buildHtml(input: RsvpEmailInput): string {
	const { name, event, partySize, dietary, notes } = input;
	const safeName = esc(name);
	const safeTitle = esc(event.title);
	const safeLocation = esc(event.location);
	const safeDate = esc(event.date);
	const safeTime = esc(event.time);
	const safeDietary = dietary ? esc(dietary) : "";
	const safeNotes = notes ? esc(notes) : "";

	const partyLine =
		partySize === 1
			? "Just you"
			: `You + ${partySize - 1} guest${partySize - 1 === 1 ? "" : "s"}`;

	return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#fafaf9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c1917;">
	<div style="max-width:560px;margin:0 auto;padding:32px 24px;">
		<h1 style="margin:0 0 4px;font-size:24px;font-weight:600;color:#1c1917;">You're confirmed 🎉</h1>
		<p style="margin:0 0 24px;color:#57534e;">Thanks for the RSVP, ${safeName}!</p>

		<div style="background:#ffffff;border:1px solid #e7e5e4;border-radius:12px;padding:20px 24px;">
			<h2 style="margin:0 0 12px;font-size:18px;font-weight:600;color:#1c1917;">${safeTitle}</h2>
			<table cellpadding="0" cellspacing="0" style="font-size:14px;color:#44403c;line-height:1.6;">
				<tr><td style="padding-right:12px;color:#78716c;">When</td><td>${safeDate} · ${safeTime}</td></tr>
				<tr><td style="padding-right:12px;color:#78716c;">Where</td><td>${safeLocation}</td></tr>
				<tr><td style="padding-right:12px;color:#78716c;">Party</td><td>${partyLine}</td></tr>
				${safeDietary ? `<tr><td style="padding-right:12px;color:#78716c;">Dietary</td><td>${safeDietary}</td></tr>` : ""}
				${safeNotes ? `<tr><td style="padding-right:12px;color:#78716c;vertical-align:top;">Notes</td><td>${safeNotes}</td></tr>` : ""}
			</table>
		</div>

		<p style="margin:24px 0 0;font-size:14px;color:#44403c;">
			Attached is a calendar invite — open the file and your calendar app will
			offer to add it.
		</p>

		<p style="margin:24px 0 0;font-size:14px;color:#44403c;">
			<a href="${input.eventUrl}" style="color:#1c1917;">View the invite page</a>
		</p>

		<p style="margin:32px 0 0;font-size:12px;color:#a8a29e;">
			Sent because you RSVPed to this event. If you need to update your
			response, reply to this email.
		</p>
	</div>
</body>
</html>`;
}

function buildText(input: RsvpEmailInput): string {
	const { name, event, partySize, dietary, notes } = input;
	const partyLine =
		partySize === 1
			? "Just you"
			: `You + ${partySize - 1} guest${partySize - 1 === 1 ? "" : "s"}`;

	const lines = [
		`Hi ${name},`,
		"",
		`Thanks for the RSVP! Here are the details for ${event.title}:`,
		"",
		`  When:  ${event.date} · ${event.time}`,
		`  Where: ${event.location}`,
		`  Party: ${partyLine}`,
		dietary ? `  Dietary: ${dietary}` : "",
		notes ? `  Notes: ${notes}` : "",
		"",
		`An .ics calendar invite is attached — open it to add this to your calendar.`,
		"",
		`View the invite page: ${input.eventUrl}`,
		"",
		"— Sent by invite-app",
	];
	return lines.filter(Boolean).join("\n");
}

/**
 * Send an RSVP confirmation email with an .ics attachment via the Resend
 * HTTPS API. Caller should treat this as best-effort and not fail the
 * RSVP request on error.
 */
export async function sendRsvpConfirmation(
	input: RsvpEmailInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
	try {
		const ics = buildIcsAttachment(input.event, input.eventUrl);

		// Resend expects attachment.content as a Buffer (it base64-encodes
		// internally) or a base64 string.
		const attachments = ics
			? [
					{
						filename: ics.filename,
						content: ics.content,
						contentType: "text/calendar",
					},
				]
			: [];

		const replyTo = process.env.RESEND_REPLY_TO;
		const client = getClient();
		const { error } = await client.emails.send({
			from: getFrom(),
			to: input.to,
			replyTo: replyTo || undefined,
			subject: `You're confirmed: ${input.event.title}`,
			text: buildText(input),
			html: buildHtml(input),
			attachments,
			headers: {
				"X-Entity-Ref-ID": `${input.event.id}-${Date.now()}`,
			},
		});

		if (error) {
			return { ok: false, error: error.message };
		}

		return { ok: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: message };
	}
}

export interface HostNotificationInput {
	hosts: string[];
	name: string;
	status: "going" | "not-going" | string;
	guestEmail?: string;
	partySize: number;
	dietary?: string;
	notes?: string;
	event: EventForIcs;
}

function buildHostHtml(input: HostNotificationInput): string {
	const { name, status, guestEmail, partySize, dietary, notes, event } = input;
	const isGoing = status === "going";
	const statusLabel = isGoing
		? `<span style="color:#15803d;font-weight:600;">Going</span>`
		: `<span style="color:#b91c1c;font-weight:600;">Can't make it</span>`;
	const safeName = esc(name);
	const safeTitle = esc(event.title);
	const safeDate = esc(event.date);
	const safeTime = esc(event.time);
	const safeEmail = guestEmail ? esc(guestEmail) : "";
	const safeDietary = dietary ? esc(dietary) : "";
	const safeNotes = notes ? esc(notes).replace(/\n/g, "<br>") : "";
	const partyLine =
		partySize === 1
			? "1"
			: `${partySize} (${partySize - 1} guest${partySize - 1 === 1 ? "" : "s"} + host)`;

	const guestBlock = isGoing
		? `<table cellpadding="0" cellspacing="0" style="font-size:14px;color:#44403c;line-height:1.6;margin-top:12px;">
				<tr><td style="padding-right:12px;color:#78716c;">Email</td><td><a href="mailto:${safeEmail}" style="color:#1c1917;">${safeEmail}</a></td></tr>
				<tr><td style="padding-right:12px;color:#78716c;">Party</td><td>${partyLine}</td></tr>
				${safeDietary ? `<tr><td style="padding-right:12px;color:#78716c;">Dietary</td><td>${safeDietary}</td></tr>` : `<tr><td style="padding-right:12px;color:#78716c;">Dietary</td><td style="color:#a8a29e;">none</td></tr>`}
				${safeNotes ? `<tr><td style="padding-right:12px;color:#78716c;vertical-align:top;">Notes</td><td>${safeNotes}</td></tr>` : ""}
			</table>
			<p style="margin:16px 0 0;font-size:13px;color:#78716c;">Reply to this email to respond directly to the guest.</p>`
		: "";

	return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#fafaf9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c1917;">
	<div style="max-width:560px;margin:0 auto;padding:32px 24px;">
		<p style="margin:0 0 4px;font-size:13px;color:#78716c;text-transform:uppercase;letter-spacing:0.05em;">New RSVP</p>
		<h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#1c1917;">${safeName} — ${statusLabel}</h1>

		<div style="background:#ffffff;border:1px solid #e7e5e4;border-radius:12px;padding:20px 24px;">
			<h2 style="margin:0 0 8px;font-size:16px;font-weight:600;color:#1c1917;">${safeTitle}</h2>
			<p style="margin:0;font-size:14px;color:#57534e;">${safeDate} · ${safeTime}</p>
			${guestBlock}
		</div>
	</div>
</body>
</html>`;
}

function buildHostText(input: HostNotificationInput): string {
	const { name, status, guestEmail, partySize, dietary, notes, event } = input;
	const statusLabel = status === "going" ? "Going" : "Can't make it";
	const lines = [
		`New RSVP for ${event.title}`,
		"",
		`  Name:   ${name}`,
		`  Status: ${statusLabel}`,
	];
	if (status === "going") {
		lines.push(`  Email:  ${guestEmail ?? "(not provided)"}`);
		lines.push(`  Party:  ${partySize}`);
		lines.push(`  Dietary: ${dietary || "none"}`);
		if (notes) lines.push(`  Notes: ${notes}`);
		lines.push("");
		lines.push("Reply to this email to respond directly to the guest.");
	}
	return lines.join("\n");
}

/**
 * Send an RSVP notification email to the host(s). All hosts receive a single
 * email (Resend supports multiple `to` recipients) with reply-to set to the
 * guest so hitting Reply in a mail client goes straight to them. Returns
 * ok=true if Resend accepted the request, even if individual recipients
 * later bounce.
 */
export async function sendHostNotification(
	input: HostNotificationInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
	if (input.hosts.length === 0) return { ok: true };

	try {
		const statusLabel = input.status === "going" ? "going" : "can't make it";
		const subject = `RSVP from ${input.name} (${statusLabel}) — ${input.event.title}`;

		// Only set replyTo to the guest when they actually provided an email
		// (i.e. status === "going"). Otherwise fall back to the default.
		const replyTo =
			input.status === "going" && input.guestEmail
				? input.guestEmail
				: (process.env.RESEND_REPLY_TO ?? undefined);

		const client = getClient();
		const { error } = await client.emails.send({
			from: getFrom(),
			to: input.hosts,
			replyTo,
			subject,
			text: buildHostText(input),
			html: buildHostHtml(input),
			headers: {
				"X-Entity-Ref-ID": `host-${input.event.id}-${Date.now()}`,
			},
		});

		if (error) {
			return { ok: false, error: error.message };
		}

		return { ok: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: message };
	}
}
