import { randomUUID } from "node:crypto";
export function generateId() {
    return randomUUID();
}
export function now() {
    return Date.now();
}
export function truncate(text, maxLength) {
    if (text.length <= maxLength)
        return text;
    return text.slice(0, maxLength) + "...";
}
//# sourceMappingURL=utils.js.map