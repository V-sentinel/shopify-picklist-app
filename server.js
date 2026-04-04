app.post("/save", async (req, res) => {
  try {
    console.log("Saving:", req.body.value);

    const result = await pool.query(
      "INSERT INTO test_data (value) VALUES ($1) RETURNING *",
      [req.body.value]
    );

    console.log("Saved:", result.rows[0]);

    res.send("✅ Saved successfully!");

  } catch (err) {
    console.error("REAL ERROR:", err);

    res.send(`
      <h2 style="color:red;">REAL ERROR</h2>
      <pre>${err.stack}</pre>
    `);
  }
});
