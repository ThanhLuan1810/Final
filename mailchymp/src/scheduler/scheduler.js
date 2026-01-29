const { pool } = require("../config/db");
const { sendCampaignToList } = require("../services/campaign.service");

const PORT = Number(process.env.PORT || 3000);

let schedulerBusy = false;

function startScheduler() {
  setInterval(async () => {
    if (schedulerBusy) return;
    schedulerBusy = true;

    try {
      const [due] = await pool.query(
        `SELECT id, user_id, list_id
         FROM campaigns
         WHERE UPPER(status)='SCHEDULED'
           AND scheduled_at IS NOT NULL
           AND scheduled_at <= NOW()
         ORDER BY scheduled_at ASC
         LIMIT 3`,
      );

      for (const c of due) {
        // ✅ CLAIM job chống trùng
        const [u] = await pool.query(
          `UPDATE campaigns
           SET status='SENDING'
           WHERE id=? AND UPPER(status)='SCHEDULED'`,
          [c.id],
        );
        if (u.affectedRows === 0) continue;

        try {
          if (!c.list_id) {
            await pool.query(
              `UPDATE campaigns SET status='FAILED' WHERE id=?`,
              [c.id],
            );
            continue;
          }

          await sendCampaignToList({
            campaign_id: c.id,
            list_id: c.list_id,
            user_id: c.user_id,
            port: PORT,
          });
        } catch (e) {
          console.error("SCHEDULE RUN ERROR:", c.id, e?.message || e);
          await pool.query(`UPDATE campaigns SET status='FAILED' WHERE id=?`, [
            c.id,
          ]);
        }
      }
    } catch (e) {
      console.error("SCHEDULER LOOP ERROR:", e);
    } finally {
      schedulerBusy = false;
    }
  }, 15000);
}

module.exports = { startScheduler };
