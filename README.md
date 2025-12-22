# Antidetect Instagram Automation

A sophisticated Instagram automation tool with antidetect capabilities, built with Python, PyQt6, and Camoufox. This application allows for managing multiple browser profiles and performing human-like actions on Instagram to minimize detection.

## Features

- **Profile Management**: Create, edit, and delete browser profiles. Supports local storage and cloud synchronization via Supabase.
- **Antidetect Browser**: Powered by `Camoufox` (based on Playwright) with humanized cursor movements, fingerprint spoofing, and proxy support.
- **Instagram Automation**:
    - **Smart Scrolling**: Automatically scroll through the feed and reels with configurable chances for likes, comments, and follows.
    - **Targeted Following**: Follow users from a list with "pre-follow" interactions (watching highlights, liking posts) to appear more human.
    - **Story Watching**: Automatically watch stories before or during other actions.
    - **Messaging**: Send automated messages to users.
    - **Unfollowing**: Manage and reduce your following list.
    - **Follow Request Approval**: Automatically approve incoming follow requests.
- **Graphical User Interface**: User-friendly PyQt6-based dashboard with tabs for profiles, automation settings, lists, and logs.
- **Command Line Interface**: Run specific automation tasks directly via `launcher.py`.

## Project Structure

- `automation/`: Core logic for Instagram interactions and browser control.
    - `Follow/`: Logic for following users with pre-follow interactions.
    - `scrolling/`: Feed and Reels scrolling implementations.
    - `messaging/`: Direct messaging automation.
    - `stories/`: Story watching logic.
- `core/`: Managers for profiles and background processes.
- `gui/`: PyQt6 implementation for the desktop application.
- `supabase/`: Database client and migrations for cloud synchronization.
- `utils/`: Common utilities (file handling, TOTP, etc.).

## Setup

### Prerequisites

- Python 3.10+
- [Camoufox](https://camoufox.com/) browser and its dependencies.

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd anti
   ```

2. Install dependencies:
   ```bash
   pip install PyQt6 camoufox supabase python-dotenv
   ```

3. Setup Environment Variables:
   Create a `.env` file in the root directory and add your Supabase credentials:
   ```env
   SUPABASE_URL=your_supabase_url
   SUPABASE_PUBLISHABLE_KEY=your_publishable_key
   SUPABASE_SECRET_KEY=your_secret_key
   ```

### Running the Application

- **GUI Mode**:
  ```bash
  python main.py
  ```

- **CLI Mode**:
  ```bash
  python launcher.py --name "ProfileName" --action "scroll" --duration 10
  ```

## Configuration

- `db.json`: Local storage for profiles.
- `instagram_settings.json`: Configuration for Instagram automation parameters.
- `message.txt`, `message_2.txt`: Templates for automated messaging.

## License

[Add License Information Here]
