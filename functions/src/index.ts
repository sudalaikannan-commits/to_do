import * as functions from "firebase-functions";
import { createApp } from "./app.js";
import "./db.js";

const app = createApp();

/** Single HTTPS function exposing the workspace REST API (same /api/* paths). */
export const api = functions.region("asia-south1").https.onRequest(app);

export { onUserDeleted, dailyDigest } from "./triggers.js";
