// Toast notification system
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-content">
      <div class="toast-icon">
        ${getToastIcon(type)}
      </div>
      <span class="toast-message">${message}</span>
      <button class="toast-close" onclick="this.parentElement.parentElement.remove()">
        <svg width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  `;

  // Add toast styles if not present
  if (!document.getElementById("toast-styles")) {
    const styles = document.createElement("style");
    styles.id = "toast-styles";
    styles.textContent = `
      .toast {
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--bs-gray-800);
        border: 1px solid var(--bs-gray-700);
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 1000;
        animation: slideIn 0.3s ease-out;
        max-width: 400px;
      }
      .toast-content {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .toast-icon {
        flex-shrink: 0;
      }
      .toast-message {
        color: var(--bs-gray-100);
        flex: 1;
        font-size: 14px;
      }
      .toast-close {
        background: none;
        border: none;
        color: var(--bs-gray-400);
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        flex-shrink: 0;
      }
      .toast-close:hover {
        background: var(--bs-gray-700);
        color: var(--bs-gray-200);
      }
      .toast-success .toast-icon { color: var(--bs-success); }
      .toast-error .toast-icon { color: var(--bs-danger); }
      .toast-warning .toast-icon { color: var(--bs-warning); }
      .toast-info .toast-icon { color: var(--bs-info); }
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(styles);
  }

  document.body.appendChild(toast);

  // Auto remove after 5 seconds
  setTimeout(() => {
    if (toast.parentElement) {
      toast.remove();
    }
  }, 5000);
}

function getToastIcon(type) {
  const icons = {
    success:
      '<svg width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none"><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"></path><path d="M9 12l2 2l4 -4"></path></svg>',
    error:
      '<svg width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none"><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"></path><path d="M12 9v4"></path><path d="M12 16h.01"></path></svg>',
    warning:
      '<svg width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none"><path d="M12 9v4"></path><path d="M12 16h.01"></path><path d="M12 2.5a9.5 9.5 0 1 1 0 19a9.5 9.5 0 1 1 0 -19z"></path></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none"><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"></path><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>',
  };
  return icons[type] || icons.info;
}

// Enhanced PM2 actions with loading states and notifications
async function pm2AppAction(appName, action) {
  const actionMessages = {
    reload: "Reloading",
    restart: "Restarting",
    stop: "Stopping",
    start: "Starting",
  };

  const successMessages = {
    reload: "reloaded successfully",
    restart: "restarted successfully",
    stop: "stopped successfully",
    start: "started successfully",
  };

  try {
    // Show loading toast
    showToast(`${actionMessages[action]} ${appName}...`, "info");

    // Add loading state to button
    const buttons = document.querySelectorAll(
      `button[onclick*="${appName}"][onclick*="${action}"]`
    );
    buttons.forEach((btn) => {
      btn.disabled = true;
      btn.innerHTML = `
        <div class="loading-spinner" style="width: 16px; height: 16px; border: 2px solid var(--bs-gray-600); border-top: 2px solid var(--bs-primary); border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto;"></div>
      `;
    });

    const response = await fetch(`/api/apps/${appName}/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      showToast(`${appName} ${successMessages[action]}`, "success");

      // Reload page after short delay to show success message
      setTimeout(() => {
        location.reload();
      }, 1500);
    } else {
      throw new Error(`Failed to ${action} ${appName}`);
    }
  } catch (error) {
    console.error("PM2 action error:", error);
    showToast(`Failed to ${action} ${appName}`, "error");

    // Re-enable buttons on error
    setTimeout(() => {
      location.reload();
    }, 2000);
  }
}

// Real-time status updates
function initializeStatusUpdates() {
  if (typeof io !== "undefined") {
    const socket = io();

    socket.on("app-status-change", (data) => {
      const { appName, status, metrics } = data;
      updateAppStatus(appName, status, metrics);
    });

    socket.on("connect", () => {
      console.log("Connected to PM2 WebUI");
    });

    socket.on("disconnect", () => {
      console.log("Disconnected from PM2 WebUI");
      showToast("Connection lost. Attempting to reconnect...", "warning");
    });
  }
}

function updateAppStatus(appName, status, metrics = {}) {
  // Update status badges
  const badges = document.querySelectorAll(`[data-app="${appName}"] .badge`);
  badges.forEach((badge) => {
    badge.className =
      status === "online" ? "badge bg-green-lt" : "badge bg-red-lt";
    badge.textContent = status;
  });

  // Update metrics if provided
  if (metrics.cpu) {
    const cpuElements = document.querySelectorAll(
      `[data-app="${appName}"] .cpu-metric`
    );
    cpuElements.forEach((el) => (el.textContent = `${metrics.cpu}%`));
  }

  if (metrics.memory) {
    const memElements = document.querySelectorAll(
      `[data-app="${appName}"] .memory-metric`
    );
    memElements.forEach((el) => (el.textContent = metrics.memory));
  }

  // Update card border color
  const cards = document.querySelectorAll(`[data-app="${appName}"]`);
  cards.forEach((card) => {
    const statusTop = card.querySelector(".card-status-top");
    if (statusTop) {
      statusTop.className =
        status === "online"
          ? "card-status-top bg-success"
          : "card-status-top bg-danger";
    }
  });
}

// Enhanced search functionality for dashboard
function initializeSearch() {
  const searchInput = document.getElementById("appSearch");
  if (searchInput) {
    searchInput.addEventListener(
      "input",
      debounce((e) => {
        const searchTerm = e.target.value.toLowerCase();
        filterApps(searchTerm);
      }, 300)
    );
  }
}

function filterApps(searchTerm) {
  const appCards = document.querySelectorAll(".card[data-app]");

  appCards.forEach((card) => {
    const appName = card.dataset.app.toLowerCase();
    const shouldShow = !searchTerm || appName.includes(searchTerm);

    card.style.display = shouldShow ? "block" : "none";

    // Add animation
    if (shouldShow) {
      card.style.animation = "fadeIn 0.3s ease-in";
    }
  });
}

// Utility functions
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", function () {
  initializeStatusUpdates();
  initializeSearch();

  // Add smooth transitions to cards
  const cards = document.querySelectorAll(".card");
  cards.forEach((card) => {
    card.style.transition = "all 0.2s ease-in-out";
  });

  // Initialize tooltips if Bootstrap is available
  if (typeof bootstrap !== "undefined" && bootstrap.Tooltip) {
    const tooltipTriggerList = [].slice.call(
      document.querySelectorAll('[data-bs-toggle="tooltip"]')
    );
    tooltipTriggerList.map(function (tooltipTriggerEl) {
      return new bootstrap.Tooltip(tooltipTriggerEl);
    });
  }
});
