/// <reference lib="webworker" />
import { solveRange } from "./altcha-range";

// One slice of the proof of work, off the main thread. The page posts {algorithm, challenge, salt, start, max};
// the reply is {ok, number|null, took}. No network, no storage, no globals beyond the message.
type Request = { algorithm: "SHA-1" | "SHA-256" | "SHA-512"; challenge: string; salt: string; start: number; max: number };

self.onmessage = async (event: MessageEvent<Request>) => {
  const { algorithm, challenge, salt, start, max } = event.data;
  try {
    const solution = await solveRange({ algorithm, challenge, salt }, start, max);
    self.postMessage({ ok: true, number: solution ? solution.number : null, took: solution ? solution.took : 0 });
  } catch {
    self.postMessage({ ok: false });
  }
};
