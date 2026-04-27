export default function RealmPicker() {
  return (
    <section className="placeholder-pane">
      <div className="placeholder-eyebrow">Realms</div>
      <h1 className="placeholder-title">Realm Picker</h1>
      <p className="placeholder-body">
        Realm list with status + player count + Play button lands in PR 5.
        Sources from <code>GET /api/v1/launcher/realms</code> (public, rate-limited).
      </p>
    </section>
  );
}
