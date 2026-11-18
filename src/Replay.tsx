// Finished chess games: a list of them, and a viewer that steps through the moves.
import { Chess, type PieceSymbol, type Color } from 'chess.js';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PieceView } from './ChessBoard';
import { BOARD_THEME_BY_ID, type BoardThemeId, type PieceSetId } from './pieceSets';

export type FinishedGame = {
  id: string;
  pgn: string;
  /** When it ended (ms). */
  date: number;
  result: string;
  moves: number;
};

export function PastGames({
  games,
  onOpen,
  onDelete,
  onClose,
}: {
  games: FinishedGame[];
  onOpen: (g: FinishedGame) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.overlay} testID="past-games">
      <View style={styles.card}>
        <Text style={styles.title}>Past games</Text>
        <ScrollView style={styles.scroll}>
          {games.length === 0 && <Text style={styles.body}>No finished games yet. They show up here after a game ends.</Text>}
          {games.map((g, i) => (
            <View key={g.id} style={styles.row}>
              <Pressable style={styles.rowMain} onPress={() => onOpen(g)} testID={`past-${i}`}>
                <Text style={styles.rowTitle}>{g.result}</Text>
                <Text style={styles.body}>
                  {new Date(g.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {g.moves}{' '}
                  {g.moves === 1 ? 'move' : 'moves'}
                </Text>
              </Pressable>
              <Pressable style={styles.del} onPress={() => onDelete(g.id)} accessibilityLabel="Delete this game" testID={`past-delete-${i}`}>
                <Text style={styles.delText}>✕</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
        <Pressable style={styles.close} onPress={onClose} testID="past-close">
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
    </View>
  );
}

type Board = ({ type: PieceSymbol; color: Color } | null)[][];

export function Replay({
  game,
  pieceSet,
  theme,
  onClose,
}: {
  game: FinishedGame;
  pieceSet: PieceSetId;
  theme: BoardThemeId;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const { boards, sans, squares } = useMemo(() => {
    const chess = new Chess();
    try {
      chess.loadPgn(game.pgn);
    } catch {
      // A game that can't be read just shows the start.
    }
    const verbose = chess.history({ verbose: true });
    const walker = new Chess();
    const list: Board[] = [walker.board() as Board];
    verbose.forEach((m) => {
      walker.move(m.san);
      list.push(walker.board() as Board);
    });
    return {
      boards: list,
      sans: verbose.map((m) => m.san),
      squares: verbose.map((m) => [m.from, m.to] as [string, string]),
    };
  }, [game.pgn]);
  const colors = BOARD_THEME_BY_ID[theme];
  const cell = 40;
  const last = step > 0 ? squares[step - 1] : null;
  const files = 'abcdefgh';
  return (
    <View style={styles.overlay} testID="replay">
      <View style={styles.card}>
        <Text style={styles.title}>{game.result}</Text>
        <View style={{ width: cell * 8, height: cell * 8, alignSelf: 'center', flexDirection: 'row', flexWrap: 'wrap' }}>
          {boards[step].flatMap((row, r) =>
            row.map((p, c) => {
              const sq = `${files[c]}${8 - r}`;
              const light = (r + c) % 2 === 0;
              const hit = last && (last[0] === sq || last[1] === sq);
              return (
                <View
                  key={sq}
                  style={{
                    width: cell,
                    height: cell,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: hit ? '#F2D35E' : light ? colors.light : colors.dark,
                  }}
                  testID={`replay-${sq}`}
                >
                  {p && <PieceView type={p.type} color={p.color} set={pieceSet} size={cell * 0.9} glow={false} />}
                </View>
              );
            }),
          )}
        </View>
        <Text style={styles.moveLine} testID="replay-move">
          {step === 0 ? 'Start' : `${Math.ceil(step / 2)}${step % 2 ? '.' : '...'} ${sans[step - 1]}`}
          {'  '}({step}/{sans.length})
        </Text>
        <View style={styles.controls}>
          {[
            { label: '⏮', to: () => 0, id: 'first' },
            { label: '◀', to: (s: number) => Math.max(0, s - 1), id: 'prev' },
            { label: '▶', to: (s: number) => Math.min(sans.length, s + 1), id: 'next' },
            { label: '⏭', to: () => sans.length, id: 'last' },
          ].map((b) => (
            <Pressable key={b.id} style={styles.ctl} onPress={() => setStep(b.to(step))} testID={`replay-${b.id}`}>
              <Text style={styles.ctlText}>{b.label}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={styles.close} onPress={onClose} testID="replay-close">
          <Text style={styles.closeText}>Back</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 40 },
  card: { width: '100%', maxWidth: 380, backgroundColor: '#1B1D24', borderRadius: 20, padding: 16, gap: 10, maxHeight: '90%' },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  body: { color: '#C9CDE0', fontSize: 14 },
  scroll: { maxHeight: 420 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#22252E', borderRadius: 14, marginBottom: 8 },
  rowMain: { flex: 1, padding: 12, gap: 2 },
  rowTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  del: { padding: 14 },
  delText: { color: '#C9CDE0', fontSize: 16 },
  close: { backgroundColor: '#3a4060', borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  closeText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  moveLine: { color: '#fff', fontSize: 16, textAlign: 'center', fontWeight: '600' },
  controls: { flexDirection: 'row', gap: 8 },
  ctl: { flex: 1, backgroundColor: '#2A2D38', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  ctlText: { color: '#fff', fontSize: 18 },
});
