'use strict';
// Legger godkjente bilder ut på Instagram, ett om gangen, med tak per døgn og minste mellomrom.
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function createPublisher({ submissions, instagram, settings, publicBaseUrl, maxPerDay = 3, minHours = 4, log = console }) {
  let running = false;

  function imageUrl(s) {
    return `${publicBaseUrl.replace(/\/$/, '')}/innsendt/${s.id}-${s.imageToken}.jpg`;
  }

  /** Setter 'posting'-innslag som ble avbrutt av en omstart tilbake til admin: vi vet ikke om de ble publisert. */
  function recover() {
    for (const s of submissions.list({ status: 'posting' })) {
      submissions.update(s.id, { status: 'held' }, 'Avbrutt av omstart under publisering. Sjekk Instagram før du godkjenner på nytt.');
    }
  }

  async function tick(now = Date.now()) {
    if (running) return { posted: false, reason: 'busy' };
    if (settings.get().paused) return { posted: false, reason: 'paused' };
    if (instagram.mode === 'off') return { posted: false, reason: 'mode-off' };
    if (instagram.mode === 'live' && !publicBaseUrl) return { posted: false, reason: 'no-public-url' };
    const real = instagram.mode === 'live';
    if (real) {
      if (submissions.postedSince(DAY).length >= maxPerDay) return { posted: false, reason: 'daily-cap' };
      if (now - submissions.lastPostedAt() < minHours * HOUR) return { posted: false, reason: 'spacing' };
    }
    const next = submissions.list({ status: 'approved' }).reverse()[0]; // eldste først
    if (!next) return { posted: false, reason: 'empty' };

    running = true;
    try {
      submissions.update(next.id, { status: 'posting' });
      const attempt = (next.instagram?.attempts || 0) + 1;
      try {
        const result = await instagram.publish({ imageUrl: publicBaseUrl ? imageUrl(next) : 'dry-run', caption: next.caption });
        submissions.update(next.id, { status: 'posted', instagram: { ...result, attempts: attempt } }, result.dryRun ? 'Testkjøring (ikke publisert på ekte)' : 'Publisert på Instagram');
        return { posted: true, id: next.id, dryRun: result.dryRun };
      } catch (err) {
        const giveUp = !err.retryable || attempt >= 3;
        submissions.update(next.id, { status: giveUp ? 'failed' : 'approved', instagram: { ...(next.instagram || {}), attempts: attempt, error: String(err.message).slice(0, 200) } }, `Publisering feilet: ${String(err.message).slice(0, 150)}`);
        log.error?.('Instagram-publisering feilet', err.message);
        return { posted: false, reason: 'error', error: err.message };
      }
    } finally {
      running = false;
    }
  }

  return { tick, recover, imageUrl };
}

module.exports = { createPublisher };
