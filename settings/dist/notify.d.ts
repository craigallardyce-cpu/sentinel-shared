/**
 * Telling subscribers that something changed, one listener at a time.
 *
 * A listener belongs to the app -- a React hook, a screen, a sync routine --
 * and this package cannot vouch for it. Each one is called on its own, and one
 * that throws is reported and passed over: the rest are still told, and the
 * caller still finishes.
 *
 * That matters most after a write. Notification happens once the value has
 * been saved, and an exception escaping from it used to reach the write's own
 * error path: the cloud layer then rolled the saved value back on this device
 * (the server kept it) and rejected a set that had succeeded (review S-07).
 * A listener's failure is the listener's; it says nothing about the value.
 */
export declare function notifyListeners(listeners: Iterable<() => void>): void;
