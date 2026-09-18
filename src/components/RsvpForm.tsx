import { useState, type FormEvent } from "react";
import confetti from "canvas-confetti";
import { User, Users, Minus, Plus } from "lucide-react";

interface Props {
	eventId: string;
}

type Status = "going" | "not-going";

function fireConfetti() {
	const duration = 1500;
	const end = Date.now() + duration;
	const colors = ["#fbbf24", "#f472b6", "#a78bfa", "#34d399"];

	(function frame() {
		confetti({
			particleCount: 3,
			angle: 60,
			spread: 55,
			origin: { x: 0, y: 0.7 },
			colors,
		});
		confetti({
			particleCount: 3,
			angle: 120,
			spread: 55,
			origin: { x: 1, y: 0.7 },
			colors,
		});
		if (Date.now() < end) {
			requestAnimationFrame(frame);
		}
	})();
}

export default function RsvpForm({ eventId }: Props) {
	const [status, setStatus] = useState<Status>("going");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [partySize, setPartySize] = useState(1);
	const [dietary, setDietary] = useState("");
	const isJustMe = partySize === 1;
	const [notes, setNotes] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [submitted, setSubmitted] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (submitting) return;

		setSubmitting(true);
		setError(null);

		const body: Record<string, unknown> = { status, name };
		if (status === "going") {
			body.email = email;
			body.party_size = partySize;
			if (dietary) body.dietary = dietary;
			if (notes) body.notes = notes;
		}

		try {
			const res = await fetch(`/api/rsvp/${eventId}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			const data = (await res.json().catch(() => ({}))) as {
				success?: boolean;
				error?: string;
			};
			if (res.ok && data.success) {
				setSubmitted(true);
				fireConfetti();
			} else {
				setError(data.error ?? "Something went wrong. Please try again.");
			}
		} catch {
			setError("Network error. Please try again.");
		} finally {
			setSubmitting(false);
		}
	}

	const canSubmit = !submitting && name.trim().length > 0;

	const inputClass =
		"mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 shadow-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-stone-500 disabled:bg-stone-50 disabled:text-stone-400";

	if (submitted) {
		return (
			<div className="mx-auto mt-8 max-w-md rounded-2xl border border-stone-200 bg-stone-50 p-10 text-center shadow-sm">
				<div className="text-5xl" aria-hidden="true">
					🎉
				</div>
				<h2 className="mt-3 text-2xl font-semibold text-stone-900">
					Thank you!
				</h2>
				<p className="mt-2 text-stone-600">
					{status === "going"
						? "Woot! We can't wait to see you there!"
						: "Bummer! We'll miss you!"}
				</p>
			</div>
		);
	}

	return (
		<form
			onSubmit={handleSubmit}
			autoComplete="off"
			className="space-y-5"
		>
			<h2 className="text-center text-xl font-semibold text-stone-900">
				Will you be there?
			</h2>

			<div className="grid grid-cols-2 gap-2 rounded-xl bg-stone-100 p-1 text-sm font-medium">
				<button
					type="button"
					aria-pressed={status === "going"}
					onClick={() => setStatus("going")}
					className={`rounded-lg px-3 py-2 transition ${
						status === "going"
							? "bg-white text-stone-900 shadow"
							: "text-stone-500 hover:text-stone-700"
					}`}
				>
					I'm going 🤩
				</button>
				<button
					type="button"
					aria-pressed={status === "not-going"}
					onClick={() => setStatus("not-going")}
					className={`rounded-lg px-3 py-2 transition ${
						status === "not-going"
							? "bg-white text-stone-900 shadow"
							: "text-stone-500 hover:text-stone-700"
					}`}
				>
					I can't go 😔
				</button>
			</div>

			<div>
				<label htmlFor="rsvp-name" className="block text-sm text-stone-600">
					Your name
				</label>
				<input
					id="rsvp-name"
					type="text"
					autoComplete="name"
					required
					value={name}
					onChange={(e) => setName(e.target.value)}
					disabled={submitting}
					className={inputClass}
				/>
			</div>

			<div
				className={`grid motion-safe:transition-[grid-template-rows] motion-safe:duration-300 motion-safe:ease-out ${
					status === "going" ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
				}`}
				aria-hidden={status !== "going"}
			>
				<div className="overflow-hidden">
					<div className="space-y-5">
						<div>
							<label htmlFor="rsvp-email" className="block text-sm text-stone-600">
								Email
							</label>
							<input
								id="rsvp-email"
								type="email"
								autoComplete="email"
								required
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								disabled={submitting}
								className={inputClass}
							/>
						</div>

						<div>
							<span className="block text-sm text-stone-600">Are you bringing anyone?</span>
							<div className="mt-2 grid grid-cols-2 gap-2">
								<button
									type="button"
									aria-pressed={isJustMe}
									onClick={() => setPartySize(1)}
									disabled={submitting}
									className={`flex flex-col items-center justify-center gap-1 rounded-xl border p-4 transition disabled:cursor-not-allowed disabled:opacity-50 ${
										isJustMe
											? "border-stone-900 text-stone-900"
											: "border-stone-200 text-stone-500 hover:border-stone-400 hover:text-stone-700"
									}`}
								>
									<span className="text-2xl font-semibold tabular-nums">1</span>
									<div className="flex items-center gap-1.5">
										<User className="h-5 w-5" aria-hidden="true" />
										<span className="text-sm font-medium">Just me</span>
									</div>
								</button>

								{isJustMe ? (
									<button
										type="button"
										onClick={() => setPartySize(2)}
										disabled={submitting}
										className="flex flex-col items-center justify-center gap-1 rounded-xl border border-stone-200 p-4 text-stone-500 transition focus:outline-none focus:ring-1 focus:ring-inset focus:ring-stone-500 hover:border-stone-400 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
									>
										<span className="text-2xl font-semibold tabular-nums opacity-60">
											2
										</span>
										<div className="flex items-center gap-1.5">
											<Users className="h-5 w-5" aria-hidden="true" />
											<span className="text-sm font-medium">My crew</span>
										</div>
									</button>
								) : (
									<div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-stone-900 p-4 text-stone-900">
										<div className="flex items-center gap-1">
											<button
												type="button"
												onClick={() =>
													setPartySize((p) => Math.max(2, p - 1))
												}
												disabled={submitting || partySize <= 2}
												aria-label="Decrease party size"
												className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-300 transition focus:outline-none focus:ring-1 focus:ring-inset focus:ring-stone-500 hover:border-stone-400 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
											>
												<Minus className="h-4 w-4" aria-hidden="true" />
											</button>
											<span className="w-8 text-center text-2xl font-semibold tabular-nums">
												{partySize}
											</span>
											<button
												type="button"
												onClick={() =>
													setPartySize((p) => Math.min(10, p + 1))
												}
												disabled={submitting || partySize >= 10}
												aria-label="Increase party size"
												className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-300 transition focus:outline-none focus:ring-1 focus:ring-inset focus:ring-stone-500 hover:border-stone-400 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
											>
												<Plus className="h-4 w-4" aria-hidden="true" />
											</button>
										</div>
										<div className="flex items-center gap-1.5">
											<Users className="h-5 w-5" aria-hidden="true" />
											<span className="text-sm font-medium">My crew</span>
										</div>
									</div>
								)}
							</div>
						</div>

						<div>
							<label
								htmlFor="rsvp-dietary"
								className="block text-sm text-stone-600"
							>
								Dietary restrictions
							</label>
							<input
								id="rsvp-dietary"
								type="text"
								value={dietary}
								onChange={(e) => setDietary(e.target.value)}
								disabled={submitting}
								placeholder="Optional"
								className={inputClass}
							/>
						</div>

						<div>
							<label htmlFor="rsvp-notes" className="block text-sm text-stone-600">
								Notes
							</label>
							<textarea
								id="rsvp-notes"
								rows={3}
								value={notes}
								onChange={(e) => setNotes(e.target.value)}
								disabled={submitting}
								placeholder="Optional"
								className={inputClass}
							/>
						</div>
					</div>
				</div>
			</div>

			<button
				type="submit"
				disabled={!canSubmit}
				className="flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
			>
				{submitting ? (
					<>
						<svg
							className="h-4 w-4 animate-spin"
							viewBox="0 0 24 24"
							fill="none"
							aria-hidden="true"
						>
							<circle
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								strokeOpacity="0.25"
								strokeWidth="4"
							/>
							<path
								d="M22 12a10 10 0 0 1-10 10"
								stroke="currentColor"
								strokeWidth="4"
								strokeLinecap="round"
							/>
						</svg>
						Sending…
					</>
				) : (
					"Send RSVP"
				)}
			</button>

			{error && (
				<p
					role="alert"
					className="text-center text-sm text-red-700"
				>
					{error}
				</p>
			)}
		</form>
	);
}