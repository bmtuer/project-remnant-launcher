export default function PatchNotes() {
  return (
    <section className="placeholder-pane">
      <div className="placeholder-eyebrow">Patch Notes</div>
      <h1 className="placeholder-title">Patch Notes</h1>
      <p className="placeholder-body">
        Renders patch notes from <code>GET /api/v1/launcher/patch-notes</code>
        in PR 3. Body typography pulls Fraunces from the site's devlog post recipe.
      </p>
    </section>
  );
}
