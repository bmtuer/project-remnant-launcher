// Brief splash while we restore the session from main-process storage.
// On a hot launch this resolves in <100ms; on a cold launch with a stored
// session, it resolves after the Supabase setSession round-trip.
export default function BootScreen() {
  return (
    <div className="boot-screen">
      <div className="boot-brand">REMNANT</div>
      <div className="boot-spinner" aria-hidden="true" />
    </div>
  );
}
