import { Image } from "expo-image";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import * as library from "./library";
import type { Store } from "./store";
import {
  DAY_MS,
  DESIGNS,
  RETENTION_CHOICES,
  SLOT_COLORS,
  type AlbumRef,
  type Design,
  type DeviceAlbum,
} from "./types";

export function RenameSheet({
  visible,
  title,
  name,
  onClose,
  onSave,
}: {
  visible: boolean;
  title: string;
  name: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name, visible]);
  const clean = text.trim();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, styles.top]}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>
            It's created on your phone the first time you tap Save. Photos you
            drop here are added to it.
          </Text>
          <TextInput
            value={text}
            onChangeText={setText}
            autoFocus
            selectTextOnFocus
            maxLength={30}
            returnKeyType="done"
            onSubmitEditing={() => clean && onSave(clean)}
            style={styles.input}
            placeholder="Album name"
            placeholderTextColor="#6B7180"
            testID="rename-input"
          />
          <View style={styles.buttons}>
            <Pressable style={styles.button} onPress={onClose}>
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.primary, !clean && styles.dim]}
              disabled={!clean}
              onPress={() => onSave(clean)}
            >
              <Text style={[styles.buttonText, styles.primaryText]}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function ReviewSheet({
  visible,
  store,
  busy,
  error,
  onClose,
  onApply,
}: {
  visible: boolean;
  store: Store;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onApply: () => void;
}) {
  const albums = store.slots
    .map((album, slot) => ({
      name: album?.name ?? "",
      slot,
      count: store.pending.filter(
        (d) => d.action.type === "album" && d.action.slot === slot,
      ).length,
    }))
    .filter((a) => a.count > 0);
  const nothing = !albums.length;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, styles.bottom]}>
        <View style={[styles.sheet, styles.tall]}>
          <Text style={styles.title}>Save to albums</Text>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollBody}
          >
            {nothing && <Text style={styles.body}>Nothing left to save.</Text>}
            {albums.map((a) => (
              <View key={a.slot} style={styles.line}>
                <View
                  style={[styles.dot, { backgroundColor: SLOT_COLORS[a.slot] }]}
                />
                <Text style={styles.lineText} numberOfLines={1}>
                  {a.name}
                </Text>
                <Text style={styles.lineCount}>
                  {a.count} {a.count === 1 ? "photo" : "photos"}
                </Text>
              </View>
            ))}
          </ScrollView>
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.buttons}>
            <Pressable style={styles.button} onPress={onClose} disabled={busy}>
              <Text style={styles.buttonText}>Not yet</Text>
            </Pressable>
            <Pressable
              style={[
                styles.button,
                styles.primary,
                (busy || nothing) && styles.dim,
              ]}
              disabled={busy || nothing}
              onPress={onApply}
              testID="apply"
            >
              {busy ? (
                <ActivityIndicator color="#101114" />
              ) : (
                <Text style={[styles.buttonText, styles.primaryText]}>
                  Save
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function BinSheet({
  visible,
  store,
  busy,
  error,
  onRestore,
  onEmpty,
  onClose,
}: {
  visible: boolean;
  store: Store;
  busy: boolean;
  error: string | null;
  onRestore: (photoId: string) => void;
  onEmpty: (photoIds: string[]) => void;
  onClose: () => void;
}) {
  const days = store.retentionDays;
  const trash = store.pending.filter((d) => d.action.type === "trash");
  const now = Date.now();
  const daysLeft = (at: number) =>
    Math.max(0, Math.ceil((at + days * DAY_MS - now) / DAY_MS));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, styles.bottom]}>
        <View style={[styles.sheet, styles.tall]}>
          <Text style={styles.title}>Trash bin</Text>
          <Text style={styles.body}>
            {trash.length
              ? "Tap a photo to put it back. Photos are deleted from your phone when their days run out."
              : "The bin is empty. Photos you flick away wait here before they are deleted."}
          </Text>
          <View style={styles.chips}>
            <Text style={styles.chipLabel}>Days to keep</Text>
            {RETENTION_CHOICES.map((n) => (
              <Pressable
                key={n}
                style={[styles.chip, n === days && styles.chipOn]}
                onPress={() => store.setRetentionDays(n)}
                accessibilityRole="button"
                accessibilityState={{ selected: n === days }}
                accessibilityLabel={`Keep for ${n} days`}
                testID={`keep-${n}`}
              >
                <Text
                  style={[styles.chipText, n === days && styles.chipTextOn]}
                >
                  {n}
                </Text>
              </Pressable>
            ))}
          </View>
          {trash.length > 0 && (
            <ScrollView style={styles.scroll}>
              <View style={styles.grid}>
                {trash.map((d) => (
                  <Pressable
                    key={d.photo.id}
                    disabled={busy}
                    onPress={() => onRestore(d.photo.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Put back. ${daysLeft(d.at)} days left`}
                    testID="bin-photo"
                  >
                    <Image
                      source={{ uri: d.photo.uri }}
                      style={styles.thumb}
                      contentFit="cover"
                    />
                    <View style={styles.left}>
                      <Text style={styles.leftText}>
                        {daysLeft(d.at) === 0 ? "today" : `${daysLeft(d.at)}d`}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.buttons}>
            <Pressable style={styles.button} onPress={onClose} disabled={busy}>
              <Text style={styles.buttonText}>Done</Text>
            </Pressable>
            <Pressable
              style={[
                styles.button,
                styles.danger,
                (busy || !trash.length) && styles.dim,
              ]}
              disabled={busy || !trash.length}
              onPress={() => onEmpty(trash.map((d) => d.photo.id))}
              testID="empty-bin"
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Delete all now</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Choose one of the albums already on the phone for an empty spot, or start a new one. */
export function AlbumPicker({
  visible,
  used,
  onPick,
  onNew,
  onClose,
}: {
  visible: boolean;
  used: AlbumRef[];
  onPick: (album: DeviceAlbum) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const [albums, setAlbums] = useState<DeviceAlbum[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setAlbums(null);
    setError(null);
    library
      .listAlbums()
      .then(setAlbums)
      .catch(() => setError("Couldn't read the albums on this phone."));
  }, []);
  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const taken = (a: DeviceAlbum) =>
    used.some(
      (u) =>
        (u.id && u.id === a.id) ||
        u.name.toLowerCase() === a.title.toLowerCase(),
    );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, styles.bottom]}>
        <View style={[styles.sheet, styles.tall]}>
          <Text style={styles.title}>Choose an album</Text>
          <Pressable style={styles.choice} onPress={onNew} testID="new-album">
            <Text style={styles.plusBig}>＋</Text>
            <View style={styles.choiceText}>
              <Text style={styles.lineText}>New album</Text>
              <Text style={styles.body}>Make a brand-new one</Text>
            </View>
          </Pressable>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollBody}
          >
            {albums === null && !error && <ActivityIndicator color="#fff" />}
            {error && (
              <>
                <Text style={styles.error}>{error}</Text>
                <Pressable style={styles.button} onPress={load}>
                  <Text style={styles.buttonText}>Try again</Text>
                </Pressable>
              </>
            )}
            {albums?.length === 0 && (
              <Text style={styles.body}>
                No albums on this phone yet. Make a new one above.
              </Text>
            )}
            {albums?.map((a, i) => {
              const isTaken = taken(a);
              return (
                <Pressable
                  key={a.id}
                  style={[styles.line, styles.pickRow, isTaken && styles.dim]}
                  disabled={isTaken}
                  onPress={() => onPick(a)}
                  accessibilityRole="button"
                  testID={`pick-${i}`}
                >
                  <Text style={styles.lineText} numberOfLines={1}>
                    {a.title}
                  </Text>
                  <Text style={styles.lineCount}>
                    {isTaken
                      ? "already here"
                      : a.count !== undefined
                        ? a.count
                        : ""}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.buttons}>
            <Pressable style={styles.button} onPress={onClose}>
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** What you can do with a filled spot: swap its album or empty it. */
export function SlotMenu({
  visible,
  name,
  locked,
  onChange,
  onRemove,
  onClose,
}: {
  visible: boolean;
  name: string;
  locked: boolean;
  onChange: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, styles.bottom]}>
        <View style={styles.sheet}>
          <Text style={styles.title} numberOfLines={1}>
            {name}
          </Text>
          {locked && (
            <Text style={styles.body}>
              Photos are waiting to be saved to this album. Tap Save first, then
              you can change this spot.
            </Text>
          )}
          <Pressable
            style={[styles.button, locked && styles.dim]}
            disabled={locked}
            onPress={onChange}
            accessibilityRole="button"
            testID="change-album"
          >
            <Text style={styles.buttonText}>Change album</Text>
          </Pressable>
          <Pressable
            style={[styles.button, locked && styles.dim]}
            disabled={locked}
            onPress={onRemove}
            accessibilityRole="button"
            testID="remove-album"
          >
            <Text style={styles.buttonText}>Empty this spot</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.primary]} onPress={onClose}>
            <Text style={[styles.buttonText, styles.primaryText]}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** A tiny picture of where the album rows sit, so the versions can be told apart at a glance. */
function Thumb({ design }: { design: Design }) {
  const bar = <View style={styles.thumbBar} />;
  return (
    <View style={styles.thumb2}>
      {design === 1 && bar}
      <View style={styles.thumbCard} />
      {design === 1 ? (
        bar
      ) : (
        <>
          {bar}
          {bar}
        </>
      )}
    </View>
  );
}

export function OptionsSheet({
  visible,
  design,
  info,
  onPick,
  onAutoFill,
  onClose,
}: {
  visible: boolean;
  design: Design;
  info: string;
  onPick: (design: Design) => void;
  onAutoFill: () => Promise<string>;
  onClose: () => void;
}) {
  const [filling, setFilling] = useState(false);
  const [result, setResult] = useState("");
  useEffect(() => {
    if (!visible) setResult("");
  }, [visible]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, styles.bottom]}>
        <View style={[styles.sheet, styles.tall]}>
          <Text style={styles.title}>Options</Text>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollBody}
          >
            <Text style={styles.section}>Layout</Text>
            {DESIGNS.map((d) => (
              <Pressable
                key={d.id}
                style={[styles.choice, d.id === design && styles.choiceOn]}
                onPress={() => onPick(d.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: d.id === design }}
                accessibilityLabel={`${d.name}. ${d.blurb}`}
                testID={`design-${d.id}`}
              >
                <Thumb design={d.id} />
                <View style={styles.choiceText}>
                  <Text style={styles.lineText}>{d.name}</Text>
                  <Text style={styles.body}>{d.blurb}</Text>
                </View>
                <Text style={styles.tick}>{d.id === design ? "✓" : ""}</Text>
              </Pressable>
            ))}
            <Text style={styles.section}>Albums</Text>
            <Pressable
              style={[styles.choice, filling && styles.dim]}
              disabled={filling}
              onPress={async () => {
                setFilling(true);
                setResult(await onAutoFill());
                setFilling(false);
              }}
              accessibilityRole="button"
              testID="autofill"
            >
              <View style={styles.choiceText}>
                <Text style={styles.lineText}>
                  Fill empty spots with my albums
                </Text>
                <Text style={styles.body}>
                  Uses the albums with the most photos first. You can change any
                  spot afterwards.
                </Text>
              </View>
              {filling && <ActivityIndicator color="#fff" />}
            </Pressable>
            {result !== "" && (
              <Text style={styles.body} testID="autofill-result">
                {result}
              </Text>
            )}
            <Text style={styles.body}>{info}</Text>
          </ScrollView>
          <View style={styles.buttons}>
            <Pressable
              style={[styles.button, styles.primary]}
              onPress={onClose}
              testID="options-done"
            >
              <Text style={[styles.buttonText, styles.primaryText]}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", padding: 16 },
  top: { justifyContent: "flex-start", paddingTop: 110 },
  bottom: { justifyContent: "flex-end", paddingBottom: 28 },
  sheet: { backgroundColor: "#1B1D24", borderRadius: 22, padding: 20, gap: 12 },
  tall: { maxHeight: "80%" },
  title: { color: "#F2F3F5", fontSize: 20, fontWeight: "700" },
  body: { color: "#A9AEB8", fontSize: 14, lineHeight: 20 },
  section: { color: "#F2F3F5", fontSize: 16, fontWeight: "700", marginTop: 8 },
  input: {
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: "#0E0F13",
    color: "#F2F3F5",
    fontSize: 17,
  },
  buttons: { flexDirection: "row", gap: 10, marginTop: 4 },
  button: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2A2D37",
  },
  buttonText: { color: "#F2F3F5", fontSize: 16, fontWeight: "600" },
  primary: { backgroundColor: "#F2F3F5" },
  primaryText: { color: "#101114" },
  dim: { opacity: 0.4 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollBody: { gap: 8 },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  lineText: { flex: 1, color: "#F2F3F5", fontSize: 16 },
  lineCount: { color: "#A9AEB8", fontSize: 15 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
    backgroundColor: "#0E0F13",
  },
  error: { color: "#FF8A8A", fontSize: 14, lineHeight: 20 },
  danger: { backgroundColor: "#B3303C" },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 10,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: "#22252E",
  },
  choiceOn: { borderColor: "#F2F3F5" },
  choiceText: { flex: 1, gap: 2 },
  tick: { color: "#F2F3F5", fontSize: 20, width: 22, textAlign: "center" },
  thumb2: {
    width: 40,
    height: 64,
    borderRadius: 8,
    padding: 4,
    gap: 3,
    backgroundColor: "#0E0F13",
  },
  plusBig: { color: "#C5C9D2", fontSize: 26, width: 40, textAlign: "center" },
  pickRow: { paddingVertical: 12, paddingHorizontal: 4 },
  thumbBar: { height: 7, borderRadius: 3, backgroundColor: "#F2A65A" },
  thumbCard: { flex: 1, borderRadius: 4, backgroundColor: "#454B59" },
  chips: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  chipLabel: { color: "#A9AEB8", fontSize: 14, marginRight: 2 },
  chip: {
    height: 34,
    minWidth: 46,
    paddingHorizontal: 11,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2A2D37",
  },
  chipOn: { backgroundColor: "#F2F3F5" },
  chipText: { color: "#F2F3F5", fontSize: 14, fontWeight: "600" },
  chipTextOn: { color: "#101114" },
  left: {
    position: "absolute",
    left: 4,
    bottom: 4,
    paddingHorizontal: 6,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  leftText: { color: "#fff", fontSize: 11, fontWeight: "700" },
});
