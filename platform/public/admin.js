const authCard = document.querySelector('#auth-card');
const authError = document.querySelector('#auth-error');
const dashboard = document.querySelector('#dashboard');

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

async function loadDashboard() {
  authError.textContent = '';
  const responses = await Promise.all([
    fetch('/v1/admin/summary', { credentials: 'same-origin' }),
    fetch('/v1/admin/events', { credentials: 'same-origin' })
  ]);
  if (responses.some((response) => response.status === 401)) throw new Error('unauthorized');
  if (responses.some((response) => !response.ok)) throw new Error('request_failed');
  const [summary, events] = await Promise.all(responses.map((response) => response.json()));
  authCard.hidden = true;
  dashboard.hidden = false;
  const values = [summary.total, summary.accepted, summary.rejected, summary.customized];
  document.querySelectorAll('#metrics b').forEach((element, index) => { element.textContent = values[index] ?? 0; });
  const tbody = document.querySelector('#events');
  tbody.innerHTML = events.events.length ? events.events.map((event) => `
    <tr>
      <td>${escapeHtml(new Date(event.received_at).toLocaleString('pt-BR'))}</td>
      <td><span class="pill">${escapeHtml(event.action)}</span></td>
      <td>${escapeHtml(event.selection_mode)}</td>
      <td>${escapeHtml(event.policy_revision)}</td>
      <td><code>${escapeHtml(event.consent_id.slice(0, 12))}…</code></td>
      <td><code>${escapeHtml(event.receipt_id.slice(0, 8))}…</code></td>
    </tr>`).join('') : '<tr><td colspan="6">Nenhum evento registrado.</td></tr>';
}

loadDashboard().catch(() => {
  authError.textContent = 'Não foi possível carregar o painel com a sessão atual.';
});
