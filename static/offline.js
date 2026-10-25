const retryButton = document.getElementById('retry');
const connectionStatus = document.getElementById('connection-status');

function updateConnectionStatus() {
	if (connectionStatus) {
		connectionStatus.textContent = navigator.onLine
			? '연결을 다시 시도할 수 있어요.'
			: 'Wi-Fi나 데이터 연결을 확인해 주세요.';
	}
}

retryButton?.addEventListener('click', () => {
	if (retryButton instanceof HTMLButtonElement) retryButton.disabled = true;
	if (connectionStatus) connectionStatus.textContent = '연결 확인 중…';
	// The worker returns this document at the original URL, so reload retries that page.
	if (location.pathname === '/offline.html') location.assign('/');
	else location.reload();
});

window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);
window.addEventListener('pageshow', () => {
	if (retryButton instanceof HTMLButtonElement) retryButton.disabled = false;
	updateConnectionStatus();
});
