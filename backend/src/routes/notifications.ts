import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { unread } = req.query as { unread?: string };
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.id, ...(unread === "true" ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const unreadCount = await prisma.notification.count({ where: { userId: req.user!.id, readAt: null } });
    res.json({ notifications, unreadCount });
  })
);

router.patch(
  "/:id/read",
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user!.id },
      data: { readAt: new Date() },
    });
    res.json({ ok: true });
  })
);

router.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ ok: true });
  })
);

export default router;
