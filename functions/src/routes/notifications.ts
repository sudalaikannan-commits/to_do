import { Router } from "express";
import { col, doc, FieldValue } from "../db.js";
import { asyncHandler, requireAuth } from "../auth.js";

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { unread } = req.query as { unread?: string };
    let query: FirebaseFirestore.Query = col.notifications()
      .where("userId", "==", req.user!.id)
      .orderBy("createdAt", "desc")
      .limit(100);
    if (unread === "true") {
      query = col.notifications().where("userId", "==", req.user!.id).where("readAt", "==", null).orderBy("createdAt", "desc").limit(100);
    }
    const snap = await query.get();
    const unreadCount = (await col.notifications().where("userId", "==", req.user!.id).where("readAt", "==", null).count().get()).data().count;
    res.json({ notifications: snap.docs.map((d) => doc(d)), unreadCount });
  })
);

router.patch(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const ref = col.notifications().doc(req.params.id);
    const snap = await ref.get();
    if (snap.exists && (snap.data() as { userId: string }).userId === req.user!.id) {
      await ref.update({ readAt: FieldValue.serverTimestamp() });
    }
    res.json({ ok: true });
  })
);

router.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    const snap = await col.notifications().where("userId", "==", req.user!.id).where("readAt", "==", null).select().get();
    const chunks: FirebaseFirestore.DocumentSnapshot[][] = [];
    for (let i = 0; i < snap.docs.length; i += 400) chunks.push(snap.docs.slice(i, i + 400));
    for (const chunk of chunks) {
      const batch = col.notifications().firestore.batch();
      chunk.forEach((d) => batch.update(d.ref, { readAt: FieldValue.serverTimestamp() }));
      await batch.commit();
    }
    res.json({ ok: true });
  })
);

export default router;
