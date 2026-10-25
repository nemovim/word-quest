export type GameEffect = {
	id: number;
	kind: 'hit' | 'miss' | 'upgrade-success' | 'upgrade-failure' | 'none';
	damage: number;
	gold: number;
	iron: number;
	stones: number;
	clear: 'dungeon' | 'boss' | null;
};
