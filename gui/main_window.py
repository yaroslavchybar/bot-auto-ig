import sys
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QTabWidget, 
    QLabel, QFrame
)
from PyQt6.QtGui import QIcon
from PyQt6.QtCore import Qt
from gui.tabs.lists_tab import ListsTab
from gui.tabs.logs_tab import LogsTab
from datetime import datetime

from core.profile_manager import ProfileManager
from core.process_manager import ProcessManager
from gui.tabs.profiles_tab import ProfilesTab
from gui.tabs.instagram import InstagramTab
from gui.styles import DARK_STYLE

class AntidetectApp(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Antidetect Browser Automation")
        self.resize(1000, 700)
        
        # Managers
        self.profile_manager = ProfileManager()
        self.process_manager = ProcessManager()

        # UI Setup
        self.setup_ui()
        self.apply_styles()

        # Sync profiles from database on startup (after UI is ready)
        self.sync_profiles_from_database()
        
    def setup_ui(self):
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QVBoxLayout(central_widget)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)
        
        # Tabs
        self.tabs = QTabWidget()
        self.profiles_tab = ProfilesTab(self)
        self.instagram_tab = InstagramTab(self)
        self.lists_tab = ListsTab(self)
        self.logs_tab = LogsTab(self)
        
        self.tabs.addTab(self.profiles_tab, "🔵 Профили")
        self.tabs.addTab(self.instagram_tab, "🟢 Instagram Работа")
        self.tabs.addTab(self.lists_tab, "🗂️ Списки")
        self.tabs.addTab(self.logs_tab, "📜 Логи")
        
        # Connect tab change signal to refresh data
        self.tabs.currentChanged.connect(self.on_tab_changed)
        
        main_layout.addWidget(self.tabs)
        
        # Status Bar
        self.status_bar = QFrame()
        self.status_bar.setFixedHeight(30)
        self.status_bar.setStyleSheet("background-color: #2d2d2d; border-top: 1px solid #444;")
        status_layout = QVBoxLayout(self.status_bar)
        status_layout.setContentsMargins(10, 0, 10, 0)
        
        self.status_label = QLabel("Ready")
        self.status_label.setStyleSheet("color: #888; font-size: 12px;")
        status_layout.addWidget(self.status_label)
        
        main_layout.addWidget(self.status_bar)

    def apply_styles(self):
        self.setStyleSheet(DARK_STYLE)

    def log(self, message):
        """Central logging - currently duplicates to tabs or status"""
        if "Profiles synchronized from database" in message:
            return
        self.status_label.setText(message)
        try:
            self.logs_tab.add_log(f"[{datetime.now().strftime('%H:%M:%S')}] {message}")
        except Exception:
            pass

    def closeEvent(self, event):
        # Clean up processes
        for name in list(self.process_manager.running_processes.keys()):
            self.process_manager.stop_profile(name)
        
        # Stop workers
        if self.instagram_tab.worker:
            self.instagram_tab.worker.stop()
            self.instagram_tab.worker.wait()
        if self.instagram_tab.follow_worker:
            self.instagram_tab.follow_worker.stop()
            self.instagram_tab.follow_worker.wait()
        if self.instagram_tab.unfollow_worker:
            self.instagram_tab.unfollow_worker.stop()
            self.instagram_tab.unfollow_worker.wait()

        event.accept()

    def sync_profiles_from_database(self):
        """Sync profiles from database to local storage"""
        try:
            self.profile_manager.sync_from_database()
        except Exception as e:
            self.log(f"⚠️ Failed to sync profiles from database: {e}")

    def on_tab_changed(self, index):
        """Called when user switches tabs - refresh data from database"""
        if index == 0:  # Profiles tab
            self.sync_profiles_from_database()
            self.profiles_tab.refresh_lists()
        elif index == 1:  # Instagram tab
            # Instagram tab uses profiles, so sync them
            self.sync_profiles_from_database()
        elif index == 2:
            self.lists_tab.fetch_lists()

def main():
    app = QApplication(sys.argv)
    window = AntidetectApp()
    window.show()
    sys.exit(app.exec())
