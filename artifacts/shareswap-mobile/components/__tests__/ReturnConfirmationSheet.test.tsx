import React from "react";
import { act } from "react";
import renderer from "react-test-renderer";
import { ReturnConfirmationSheet } from "../ReturnConfirmationSheet";
import { apiGet, apiPost } from "@/lib/api";

const mockPush = jest.fn();
const mockRecoveryRefetch = jest.fn<Promise<unknown>, []>();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ refetchUser: jest.fn() }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    card: "#ffffff",
    foreground: "#111111",
    mutedForeground: "#666666",
    muted: "#f5f5f5",
    border: "#dddddd",
    background: "#ffffff",
  }),
}));

jest.mock("@/lib/api", () => ({
  apiGet: jest.fn(),
  apiPost: jest.fn(),
  apiRequest: jest.fn(),
}));

jest.mock("@tanstack/react-query", () => {
  const React = require("react");
  return {
    useQuery: (options: { enabled: boolean; queryFn: () => Promise<unknown> }) => {
      const [data, setData] = React.useState<unknown>(undefined);
      const latestOptions = React.useRef(options);
      latestOptions.current = options;
      const mounted = React.useRef(true);
      React.useEffect(() => () => {
        mounted.current = false;
      }, []);
      const runQuery = React.useCallback(async () => {
        const result = await latestOptions.current.queryFn();
        if (mounted.current) setData(result);
        return result;
      }, []);

      mockRecoveryRefetch.mockImplementation(runQuery);
      React.useEffect(() => {
        if (options.enabled) void runQuery().catch(() => undefined);
      }, [options.enabled, runQuery]);

      return { data };
    },
    useMutation: (options: {
      mutationFn: () => Promise<unknown>;
      onSuccess?: (data: unknown) => void;
      onError?: (error: Error & { status?: number }) => void;
    }) => {
      const [isPending, setIsPending] = React.useState(false);
      const mutate = React.useCallback(() => {
        setIsPending(true);
        void Promise.resolve()
          .then(() => options.mutationFn())
          .then(
            (data) => options.onSuccess?.(data),
            (error) => options.onError?.(error),
          )
          .finally(() => setIsPending(false));
      }, [options]);
      return { mutate, isPending };
    },
    useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  };
});

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { Feather: (props: object) => React.createElement(View, props) };
});

jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: "success" },
}));

jest.mock("expo-image-picker", () => ({}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const trees: renderer.ReactTestRenderer[] = [];
const deferredCleanup: Array<() => void> = [];

function renderSheet(
  props: Partial<React.ComponentProps<typeof ReturnConfirmationSheet>> = {},
) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <ReturnConfirmationSheet
        visible
        onClose={jest.fn()}
        onSuccess={jest.fn()}
        requestId={42}
        itemName="Tent"
        depositAmount={25}
        userRole="owner"
        {...props}
      />,
    );
  });
  trees.push(tree);
  return tree;
}

async function flushMicrotasks() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

function deferred<T>(cleanupValue: T) {
  let resolvePromise!: (value: T) => void;
  let settled = false;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  const resolve = (value: T) => {
    if (settled) return;
    settled = true;
    resolvePromise(value);
  };
  deferredCleanup.push(() => resolve(cleanupValue));
  return { promise, resolve };
}

beforeEach(() => {
  jest.mocked(apiGet).mockReset();
  jest.mocked(apiPost).mockReset();
  mockPush.mockClear();
  mockRecoveryRefetch.mockReset();
});

afterEach(async () => {
  await act(async () => {
    for (const settle of deferredCleanup.splice(0)) settle();
    await flushMicrotasks();
  });
  act(() => {
    for (const tree of trees.splice(0)) tree.unmount();
  });
});

test("a pending return stays open until recovery status confirms completion without replaying the action", async () => {
  const error = Object.assign(
    new Error("Deposit released; return confirmation pending. Retry safely."),
    { status: 503 },
  );
  const onSuccess = jest.fn();
  jest.mocked(apiPost).mockRejectedValueOnce(error);
  jest.mocked(apiGet)
    .mockResolvedValueOnce([{ id: 42, status: "PENDING" }])
    .mockResolvedValueOnce([{ id: 42, status: "COMPLETED" }]);
  const tree = renderSheet({ onSuccess });

  await act(async () => {
    tree.root.findByProps({ testID: "submit-confirm-return" }).props.onPress();
    await flushMicrotasks();
  });

  expect(apiPost).toHaveBeenCalledTimes(1);
  expect(apiGet).toHaveBeenCalledWith("/api/requests");
  expect(apiGet).toHaveBeenCalledTimes(1);
  expect(onSuccess).not.toHaveBeenCalled();
  expect(tree.root.findAllByProps({ children: error.message }).length).toBeGreaterThan(0);
  expect(tree.root.findByProps({ testID: "submit-confirm-return" })).toBeTruthy();

  await act(async () => {
    await mockRecoveryRefetch();
    await flushMicrotasks();
  });

  expect(apiGet).toHaveBeenCalledTimes(2);
  expect(onSuccess).toHaveBeenCalledTimes(1);
  expect(apiPost).toHaveBeenCalledTimes(1);
});

test("manual retry racing recovery polling only completes once", async () => {
  const error = Object.assign(
    new Error("Deposit released; return confirmation pending. Retry safely."),
    { status: 503 },
  );
  const retriedAction = deferred<unknown>({});
  const onSuccess = jest.fn();
  jest.mocked(apiPost)
    .mockRejectedValueOnce(error)
    .mockReturnValueOnce(retriedAction.promise);
  jest.mocked(apiGet)
    .mockResolvedValueOnce([{ id: 42, status: "PENDING" }])
    .mockResolvedValueOnce([{ id: 42, status: "COMPLETED_EARLY" }]);
  const tree = renderSheet({ onSuccess });

  await act(async () => {
    tree.root.findByProps({ testID: "submit-confirm-return" }).props.onPress();
    await flushMicrotasks();
  });
  expect(onSuccess).not.toHaveBeenCalled();

  await act(async () => {
    tree.root.findByProps({ testID: "submit-confirm-return" }).props.onPress();
    await flushMicrotasks();
  });
  expect(apiPost).toHaveBeenCalledTimes(2);
  expect(onSuccess).not.toHaveBeenCalled();

  await act(async () => {
    await Promise.all([
      mockRecoveryRefetch(),
      (async () => {
        retriedAction.resolve({});
        await flushMicrotasks();
      })(),
    ]);
    await flushMicrotasks();
  });

  expect(apiGet).toHaveBeenCalledTimes(2);
  expect(apiPost).toHaveBeenCalledTimes(2);
  expect(onSuccess).toHaveBeenCalledTimes(1);
});

test("a failed owner confirmation shows a visible error", async () => {
  const error = new Error("Return confirmation is temporarily unavailable");
  jest.mocked(apiPost).mockRejectedValueOnce(error);
  const tree = renderSheet();

  await act(async () => {
    tree.root.findByProps({ testID: "submit-confirm-return" }).props.onPress();
    await flushMicrotasks();
  });

  expect(tree.root.findAllByProps({ children: error.message }).length).toBeGreaterThan(0);
  expect(tree.root.findByProps({ testID: "submit-confirm-return" })).toBeTruthy();
});

test("an expired session offers sign-in instead of silently retrying the return", async () => {
  const error = Object.assign(new Error("Your session has expired."), { status: 401 });
  const onSuccess = jest.fn();
  jest.mocked(apiPost).mockRejectedValueOnce(error);
  const tree = renderSheet({ userRole: "borrower", onSuccess });

  await act(async () => {
    tree.root.findByProps({ testID: "submit-borrower-return" }).props.onPress();
    await flushMicrotasks();
  });

  expect(tree.root.findAllByProps({ testID: "return-submit-error" }).length).toBeGreaterThan(0);
  expect(tree.root.findAllByProps({
    children: "Your sign-in has expired. Sign in again, then reopen this chat to return the item.",
  }).length).toBeGreaterThan(0);
  expect(apiPost).toHaveBeenCalledTimes(1);
  expect(apiGet).not.toHaveBeenCalled();
  expect(onSuccess).not.toHaveBeenCalled();
  act(() => tree.root.findByProps({ testID: "return-sign-in" }).props.onPress());
  expect(mockPush).toHaveBeenCalledWith("/login?session_expired=1");
});