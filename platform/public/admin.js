const storageKey = 'consent_admin_token';
const authCard = document.querySelector('#auth-card');
const authForm = document.querySelector('#auth-form');
const authError = document.querySelector('#auth-error');
const tokenInput = document.querySelector('#admin-token');
const dashboard = document.querySelector('#dashboard');

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

async function loadDashboard(token) {
  authError.textContent = '';
  const headers = { Authorization: `Bearer ${token}` };
  const responses = await Promise.all([
    fetch('/v1/admin/summary', { headers }),
    fetch('/v1/admin/events', { headers })
  ]);
  if (responses.some((response) => response.status === 401)) throw new Error('unauthorized');
  if (responses.some((response) => !response.ok)) throw new Error('request_failed');
  const [summary, events] = await Promise.all(responses.map((response) => response.json()));
  sessionStorage.setItem(storageKey, token);
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

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await loadDashboard(tokenInput.value);
    tokenInput.value = '';
  } catch (error) {
    authError.textContent = error.message === 'unauthorized' ? 'Token inválido.' : 'Não foi possível carregar o painel.';
  }
});

document.querySelector('#logout').addEventListener('click', () => {
  sessionStorage.removeItem(storageKey);
  dashboard.hidden = true;
  authCard.hidden = false;
  tokenInput.focus();
});

const storedToken = sessionStorage.getItem(storageKey);
if (storedToken) loadDashboard(storedToken).catch(() => sessionStorage.removeItem(storageKey));
