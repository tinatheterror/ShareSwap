import { useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useMemo, useState } from "react";
import { Alert } from "react-native";
import { ReportSheet } from "@/components/ReportSheet";
import { affectedByBlock, blockUser, moderationErrorMessage, type ReportTargetType } from "@/lib/moderation";

export type ReportTarget = {
  targetType: ReportTargetType;
  targetId: number;
  /** In words: "this listing". */
  label: string;
  authorId?: number | null;
  authorName?: string | null;
};

/**
 * Report and block for any screen. Render `sheet` once, then call:
 *   report(target)                         open the report sheet
 *   confirmBlock(userId, name, onBlocked)  ask, then block
 *   userMenu(userId, name, onBlocked)      "Report / Block / Cancel" for a person
 */
export function useModeration(options: { onBlocked?: () => void } = {}) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<ReportTarget | null>(null);
  const [open, setOpen] = useState(false);
  const { onBlocked: defaultOnBlocked } = options;

  const report = useCallback((next: ReportTarget) => {
    setTarget(next);
    setOpen(true);
  }, []);

  const confirmBlock = useCallback(
    (userId: number, name: string, onBlocked?: () => void) => {
      Alert.alert(
        `Block ${name}?`,
        "You won't see each other's listings, profile or messages, and neither of you can send requests or messages to the other. A request that hasn't reached the handoff can be cancelled by either of you with a full refund and no penalty.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Block",
            style: "destructive",
            onPress: async () => {
              try {
                await blockUser(userId);
                qc.invalidateQueries({ predicate: (q) => affectedByBlock(q.queryKey) });
                (onBlocked ?? defaultOnBlocked)?.();
              } catch (err) {
                Alert.alert("Couldn't block", moderationErrorMessage(err));
              }
            },
          },
        ],
      );
    },
    [qc, defaultOnBlocked],
  );

  const userMenu = useCallback(
    (userId: number, name: string, onBlocked?: () => void) => {
      Alert.alert(name, undefined, [
        { text: "Report", onPress: () => report({ targetType: "user", targetId: userId, label: name, authorId: userId, authorName: name }) },
        { text: "Block", style: "destructive", onPress: () => confirmBlock(userId, name, onBlocked) },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [report, confirmBlock],
  );

  const sheet = useMemo(
    () =>
      target ? (
        <ReportSheet
          visible={open}
          onClose={() => setOpen(false)}
          targetType={target.targetType}
          targetId={target.targetId}
          targetLabel={target.label}
          authorId={target.authorId}
          authorName={target.authorName}
          onBlocked={defaultOnBlocked}
        />
      ) : null,
    [target, open, defaultOnBlocked],
  );

  return { sheet, report, confirmBlock, userMenu };
}
