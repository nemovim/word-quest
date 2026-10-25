// Synthesized locally: no downloads, and silent until the player enables sound.
export function createGameAudio() {
	let context: AudioContext | null = null;
	function tone(frequency: number, start: number, duration: number, type: OscillatorType = 'sine') {
		if (!context || context.state !== 'running') return;
		const oscillator = context.createOscillator();
		const gain = context.createGain();
		const time = context.currentTime + start;
		oscillator.type = type;
		oscillator.frequency.setValueAtTime(frequency, time);
		oscillator.frequency.exponentialRampToValueAtTime(
			Math.max(40, frequency * 0.55),
			time + duration
		);
		gain.gain.setValueAtTime(0.001, time);
		gain.gain.exponentialRampToValueAtTime(0.07, time + 0.008);
		gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
		oscillator.connect(gain);
		gain.connect(context.destination);
		oscillator.start(time);
		oscillator.stop(time + duration + 0.02);
	}
	return {
		unlock() {
			try {
				context ??= new AudioContext();
				void context.resume().catch(() => {});
			} catch {
				/* Visual feedback still works without audio support. */
			}
		},
		play(kind: 'hit' | 'critical' | 'loot' | 'rare' | 'upgrade-success' | 'upgrade-failure') {
			if (kind === 'critical') {
				tone(300, 0, 0.09, 'triangle');
				tone(65, 0.025, 0.25);
				tone(940, 0.06, 0.15, 'triangle');
			} else if (kind === 'hit') {
				tone(180, 0, 0.12, 'triangle');
				tone(75, 0.035, 0.16);
			} else if (kind === 'upgrade-failure') {
				tone(220, 0, 0.12, 'triangle');
				tone(130, 0.1, 0.2, 'triangle');
			} else {
				const notes =
					kind === 'loot'
						? [880, 1175]
						: kind === 'rare'
							? [659, 880, 1175, 1568]
							: [523, 659, 784, 1047];
				notes.forEach((note, i) => tone(note, i * 0.07, 0.2));
			}
		},
		close() {
			if (context) void context.close().catch(() => {});
		}
	};
}
