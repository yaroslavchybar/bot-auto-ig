import json
from pathlib import Path
from PyQt6.QtWidgets import QComboBox, QLineEdit

class SettingsMixin:
    """Mixin for handling loading and saving of InstagramTab settings."""

    def connect_settings_signals(self):
        """Persist settings whenever user changes controls."""
        for combo in [
            self.feed_likes_chance_slider,
            self.feed_carousel_chance_slider,
            self.feed_follows_chance_slider,
            self.reels_likes_chance_slider,
            self.reels_follows_chance_slider,
            self.reels_skip_chance_slider,
        ]:
            combo.currentIndexChanged.connect(self.save_settings)

        for checkbox in [
            self.feed_checkbox,
            self.reels_checkbox,
            self.follow_checkbox,
            self.watch_stories_checkbox,
            self.unfollow_checkbox,
            self.approve_checkbox,
            self.message_checkbox,
        ]:
            checkbox.toggled.connect(self.save_settings)
            checkbox.toggled.connect(self.update_order_visibility)

        for line_edit in [
            self.feed_time_min_input,
            self.feed_time_max_input,
            self.reels_time_min_input,
            self.reels_time_max_input,
            self.scrolling_cycle_input,
            self.parallel_profiles_input,
            self.feed_carousel_max_input,
            self.feed_stories_max_input,
            self.highlights_min_input,
            self.highlights_max_input,
            self.likes_min_input,
            self.likes_max_input,
            self.following_limit_input,
            self.unfollow_min_delay_input,
            self.unfollow_max_delay_input,
            self.reels_skip_min_input,
            self.reels_skip_max_input,
            self.reels_normal_min_input,
            self.reels_normal_max_input,
        ]:
            line_edit.editingFinished.connect(self.save_settings)

        # Toggle Headers
        self.target_toggle.clicked.connect(self.save_settings)
        self.order_toggle.clicked.connect(self.save_settings)

    def update_order_visibility(self):
        """Show/hide actions in the order list based on enabled checkboxes."""
        visibility_map = {
            "Feed Scroll": self.feed_checkbox.isChecked(),
            "Reels Scroll": self.reels_checkbox.isChecked(),
            "Follow": self.follow_checkbox.isChecked(),
            "Unfollow": self.unfollow_checkbox.isChecked(),
            "Approve Requests": self.approve_checkbox.isChecked(),
            "Send Messages": self.message_checkbox.isChecked()
        }
        
        # 1. Update List Items
        for i in range(self.action_order_list.count()):
            item = self.action_order_list.item(i)
            action_name = item.text()
            if action_name in visibility_map:
                item.setHidden(not visibility_map[action_name])
                
        # 2. Update Add Combo
        current_text = self.action_combo.currentText()
        self.action_combo.clear()
        enabled_actions = [name for name, enabled in visibility_map.items() if enabled]
        if enabled_actions:
            self.action_combo.addItems(enabled_actions)
            # Restore selection if possible, else default to first
            idx = self.action_combo.findText(current_text)
            if idx >= 0:
                self.action_combo.setCurrentIndex(idx)
            else:
                self.action_combo.setCurrentIndex(0)
            self.add_action_btn.setEnabled(True)
        else:
            self.action_combo.addItem("Нет активных действий")
            self.add_action_btn.setEnabled(False)

    def load_settings(self):
        """Load saved UI settings from disk."""
        defaults = {
            "use_private_profiles": False,
            "like_chance": 10,
            "carousel_watch_chance": 0,
            "follow_chance": 50,
            "reels_like_chance": 10,
            "reels_follow_chance": 50,
            "reels_skip_chance": 30,
            "reels_skip_min_time": 0.8,
            "reels_skip_max_time": 2.0,
            "reels_normal_min_time": 5.0,
            "reels_normal_max_time": 20.0,
            "carousel_max_slides": 3,
            "stories_max": 3,
            "min_time_minutes": 1,
            "max_time_minutes": 3,
            "feed_min_time_minutes": 1,
            "feed_max_time_minutes": 3,
            "reels_min_time_minutes": 1,
            "reels_max_time_minutes": 3,
            "cycle_interval_minutes": 11,
            "enable_feed": True,
            "enable_reels": False,
            "enable_follow": False,
            "parallel_profiles": 1,
            "watch_stories": True,
            # Follow defaults
            "highlights_min": 2,
            "highlights_max": 4,
            "likes_min": 1,
            "likes_max": 2,
            "following_limit": 3000,
            # Unfollow defaults
            "min_delay": 10,
            "max_delay": 30,
            "do_unfollow": False,
            "do_approve": False,
            "do_message": False
        }

        self.loading_settings = True
        data = defaults.copy()

        if self.settings_path.exists():
            try:
                loaded = json.loads(self.settings_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    data.update(loaded)
            except Exception as e:
                print(f"Failed to load Instagram settings: {e}")

        def set_combo_value(combo: QComboBox, value: int):
            target = f"{value}%"
            idx = combo.findText(target)
            if idx != -1:
                combo.setCurrentIndex(idx)

        set_combo_value(self.feed_likes_chance_slider, data.get("like_chance", defaults["like_chance"]))
        set_combo_value(self.feed_carousel_chance_slider, data.get("carousel_watch_chance", defaults["carousel_watch_chance"]))
        set_combo_value(self.feed_follows_chance_slider, data.get("follow_chance", defaults["follow_chance"]))
        set_combo_value(self.reels_likes_chance_slider, data.get("reels_like_chance", defaults["reels_like_chance"]))
        set_combo_value(self.reels_follows_chance_slider, data.get("reels_follow_chance", defaults["reels_follow_chance"]))
        set_combo_value(self.reels_skip_chance_slider, data.get("reels_skip_chance", defaults["reels_skip_chance"]))
        
        self.reels_skip_min_input.setText(str(data.get("reels_skip_min_time", defaults["reels_skip_min_time"])))
        self.reels_skip_max_input.setText(str(data.get("reels_skip_max_time", defaults["reels_skip_max_time"])))
        self.reels_normal_min_input.setText(str(data.get("reels_normal_min_time", defaults["reels_normal_min_time"])))
        self.reels_normal_max_input.setText(str(data.get("reels_normal_max_time", defaults["reels_normal_max_time"])))

        self.feed_checkbox.setChecked(data.get("enable_feed", True))
        self.reels_checkbox.setChecked(data.get("enable_reels", False))
        self.follow_checkbox.setChecked(data.get("enable_follow", False))
        self.watch_stories_checkbox.setChecked(data.get("watch_stories", True))

        self.feed_time_min_input.setText(str(data.get('feed_min_time_minutes', defaults['feed_min_time_minutes'])))
        self.feed_time_max_input.setText(str(data.get('feed_max_time_minutes', defaults['feed_max_time_minutes'])))
        self.reels_time_min_input.setText(str(data.get('reels_min_time_minutes', defaults['reels_min_time_minutes'])))
        self.reels_time_max_input.setText(str(data.get('reels_max_time_minutes', defaults['reels_max_time_minutes'])))
        self.scrolling_cycle_input.setText(f"{data.get('cycle_interval_minutes', defaults['cycle_interval_minutes'])}")
        self.parallel_profiles_input.setText(str(data.get("parallel_profiles", defaults["parallel_profiles"])))
        self.feed_carousel_max_input.setText(str(data.get("carousel_max_slides", defaults["carousel_max_slides"])))
        self.feed_stories_max_input.setText(str(data.get("stories_max", defaults["stories_max"])))

        self.highlights_min_input.setText(str(data.get("highlights_min", defaults["highlights_min"])))
        self.highlights_max_input.setText(str(data.get("highlights_max", defaults["highlights_max"])))
        self.likes_min_input.setText(str(data.get("likes_min", defaults["likes_min"])))
        self.likes_max_input.setText(str(data.get("likes_max", defaults["likes_max"])))
        self.following_limit_input.setText(str(data.get("following_limit", defaults["following_limit"])))

        self.unfollow_checkbox.setChecked(data.get("do_unfollow", False))
        self.approve_checkbox.setChecked(data.get("do_approve", False))
        self.message_checkbox.setChecked(data.get("do_message", False))
        self.unfollow_min_delay_input.setText(str(data.get("min_delay", 10)))
        self.unfollow_max_delay_input.setText(str(data.get("max_delay", 30)))

        # Load Action Order
        saved_order = data.get("action_order", [])
        self.action_order_list.clear()
        
        if saved_order:
            self.action_order_list.addItems(saved_order)
        else:
            # Default fallback if no saved order
            default_actions = ["Feed Scroll", "Reels Scroll", "Follow", "Unfollow", "Approve Requests", "Send Messages"]
            self.action_order_list.addItems(default_actions)

        # Restore Toggle Headers
        self.target_toggle.setChecked(data.get("header_target_expanded", True))
        self.target_toggle.toggle_view()
        
        self.order_toggle.setChecked(data.get("header_order_expanded", True))
        self.order_toggle.toggle_view()

        self.update_order_visibility()
        self.loading_settings = False

    def save_settings(self):
        """Save current UI settings to disk."""
        if self.loading_settings:
            return

        def parse_int_field(field: QLineEdit, default: int) -> int:
            try:
                return int(field.text().split()[0])
            except Exception:
                return default

        def parse_float_field(field: QLineEdit, default: float) -> float:
            try:
                return float(field.text().split()[0])
            except Exception:
                return default

        # Collect action order
        action_order = [self.action_order_list.item(i).text() for i in range(self.action_order_list.count())]

        payload = {
            "use_private_profiles": True,  # Always use private profiles now
            "action_order": action_order,
            "like_chance": int(self.feed_likes_chance_slider.currentText().replace('%', '')),
            "carousel_watch_chance": int(self.feed_carousel_chance_slider.currentText().replace('%', '')),
            "follow_chance": int(self.feed_follows_chance_slider.currentText().replace('%', '')),
            "reels_like_chance": int(self.reels_likes_chance_slider.currentText().replace('%', '')),
            "reels_follow_chance": int(self.reels_follows_chance_slider.currentText().replace('%', '')),
            "reels_skip_chance": int(self.reels_skip_chance_slider.currentText().replace('%', '')),
            "reels_skip_min_time": parse_float_field(self.reels_skip_min_input, 0.8),
            "reels_skip_max_time": parse_float_field(self.reels_skip_max_input, 2.0),
            "reels_normal_min_time": parse_float_field(self.reels_normal_min_input, 5.0),
            "reels_normal_max_time": parse_float_field(self.reels_normal_max_input, 20.0),
            "carousel_max_slides": parse_int_field(self.feed_carousel_max_input, 3),
            "stories_max": parse_int_field(self.feed_stories_max_input, 3),
            "min_time_minutes": parse_int_field(self.feed_time_min_input, 1),
            "max_time_minutes": parse_int_field(self.feed_time_max_input, 3),
            "feed_min_time_minutes": parse_int_field(self.feed_time_min_input, 1),
            "feed_max_time_minutes": parse_int_field(self.feed_time_max_input, 3),
            "reels_min_time_minutes": parse_int_field(self.reels_time_min_input, 1),
            "reels_max_time_minutes": parse_int_field(self.reels_time_max_input, 3),
            "cycle_interval_minutes": parse_int_field(self.scrolling_cycle_input, 11),
            "enable_feed": self.feed_checkbox.isChecked(),
            "enable_reels": self.reels_checkbox.isChecked(),
            "enable_follow": self.follow_checkbox.isChecked(),
            "parallel_profiles": parse_int_field(self.parallel_profiles_input, 1),
            "watch_stories": self.watch_stories_checkbox.isChecked(),
            
            # Follow settings
            "highlights_min": parse_int_field(self.highlights_min_input, 2),
            "highlights_max": parse_int_field(self.highlights_max_input, 4),
            "likes_min": parse_int_field(self.likes_min_input, 1),
            "likes_max": parse_int_field(self.likes_max_input, 2),
            "following_limit": parse_int_field(self.following_limit_input, 3000),
            
            # Unfollow settings
            "min_delay": parse_int_field(self.unfollow_min_delay_input, 10),
            "max_delay": parse_int_field(self.unfollow_max_delay_input, 30),
            "do_unfollow": self.unfollow_checkbox.isChecked(),
            "do_approve": self.approve_checkbox.isChecked(),
            "do_message": self.message_checkbox.isChecked(),

            # Toggle Headers
            "header_target_expanded": self.target_toggle.isChecked(),
            "header_order_expanded": self.order_toggle.isChecked()
        }

        try:
            self.settings_path.write_text(json.dumps(payload, indent=4, ensure_ascii=False), encoding="utf-8")
        except Exception as e:
            print(f"Failed to save Instagram settings: {e}")
