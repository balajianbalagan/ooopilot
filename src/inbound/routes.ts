import { Router } from "express";
import { handleInboundRequest, type InboundChannel } from "./intake.js";
import { getPrimaryEmployee, listInboundRequests } from "../knowledge/repository.js";

export const inboundRouter: Router = Router();

/**
 * Generic inbound intake.
 *
 * `POST /inbound/request { channel, from, requesterName, topic }`
 *
 * A real telephony DID (Twilio, Vonage, a SIP trunk) can point its
 * missed-call or voicemail webhook straight at this route by mapping its
 * caller-id field to `from`. The rest of the pipeline is channel-agnostic.
 */
inboundRouter.post("/request", async (req, res) => {
  const body = req.body ?? {};
  const outcome = await handleInboundRequest({
    channel: (body.channel as InboundChannel) ?? "API",
    from: String(body.from ?? body.caller ?? body.From ?? ""),
    requesterName: body.requesterName ?? body.name,
    topic: body.topic ?? body.reason,
  });
  res.status(outcome.accepted ? 202 : 400).json(outcome);
});

/** Missed call / IVR hang-up on the OOO line -> immediate callback. */
inboundRouter.post("/call", async (req, res) => {
  const body = req.body ?? {};
  const outcome = await handleInboundRequest({
    channel: "PHONE_INTAKE",
    from: String(body.from ?? body.From ?? body.caller ?? ""),
    requesterName: body.requesterName ?? body.name,
    topic: body.topic ?? "project status update",
  });
  res.status(outcome.accepted ? 202 : 400).json(outcome);
});

/** Inbound SMS to the OOO line -> callback, using the message body as the topic. */
inboundRouter.post("/sms", async (req, res) => {
  const body = req.body ?? {};
  const outcome = await handleInboundRequest({
    channel: "SMS",
    from: String(body.from ?? body.From ?? ""),
    requesterName: body.requesterName ?? body.name,
    topic: String(body.text ?? body.Body ?? "project status update"),
  });
  res.status(outcome.accepted ? 202 : 400).json(outcome);
});

/** "Call me about this" web widget. */
inboundRouter.post("/web", async (req, res) => {
  const body = req.body ?? {};
  const outcome = await handleInboundRequest({
    channel: "WEB",
    from: String(body.from ?? body.phone ?? ""),
    requesterName: body.requesterName ?? body.name,
    topic: body.topic,
  });
  res.status(outcome.accepted ? 202 : 400).json(outcome);
});

inboundRouter.get("/requests", (_req, res) => {
  const employee = getPrimaryEmployee();
  res.json({ employee: employee.name, requests: listInboundRequests(employee.id) });
});
