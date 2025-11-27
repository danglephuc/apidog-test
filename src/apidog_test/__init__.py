"""
Apidog Test CLI - Initialize Apidog test infrastructure with AI agent integration.

This CLI tool downloads templates and scripts from GitHub, creates the .apidog folder
structure, and sets up AI agent command definitions for Cursor and GitHub Copilot.
"""

import hashlib
import json
import os
import re
import subprocess
import shutil
import sys
import time
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Literal
from urllib.parse import urljoin

import httpx
import typer
from platformdirs import user_cache_dir
from readchar import readkey, key
from rich.console import Console
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.tree import Tree

__version__ = "1.0.0"

# Initialize rich console for formatted output
console = Console()

# Create typer app
app = typer.Typer(
    name="apidog-test",
    help="Initialize Apidog test infrastructure with AI agent integration",
    add_completion=False,
)

# ============================================================================
# Configuration Constants
# ============================================================================

# AI Agent Configuration (T004)
AGENT_CONFIG = {
    "cursor": {
        "name": "Cursor",
        "folder": ".cursor/commands/",
        "install_url": None,
        "requires_cli": False,
    },
    "copilot": {
        "name": "GitHub Copilot",
        "folder": ".github/agents/",
        "install_url": None,
        "requires_cli": False,
    },
    "none": {
        "name": "None (skip AI setup)",
        "folder": "",
        "install_url": None,
        "requires_cli": False,
    },
}

# Retry Configuration (T005)
RETRY_CONFIG = {
    "attempts": 3,
    "delays": [1, 2, 4],  # seconds (exponential backoff)
    "timeout": 60,        # seconds
}

# GitHub Configuration (T005)
GITHUB_REPO_OWNER = "danglephuc"
GITHUB_REPO_NAME = "apidog-test"
GITHUB_API_URL = f"https://api.github.com/repos/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}/releases/latest"


# ============================================================================
# Core Utilities
# ============================================================================

class StepTracker:
    """Track and visualize progress for multi-step operations (T006)."""
    
    def __init__(self, title: str = "Progress"):
        self.title = title
        self.steps: List[Dict[str, Any]] = []
        self.refresh_callback: Optional[callable] = None
    
    def add(self, name: str, status: str = "pending") -> int:
        """Add a new step and return its index."""
        self.steps.append({"name": name, "status": status})
        return len(self.steps) - 1
    
    def start(self, index: int):
        """Mark a step as in progress."""
        self.steps[index]["status"] = "running"
        if self.refresh_callback:
            self.refresh_callback()
    
    def complete(self, index: int):
        """Mark a step as completed."""
        self.steps[index]["status"] = "complete"
        if self.refresh_callback:
            self.refresh_callback()
    
    def error(self, index: int, message: str = ""):
        """Mark a step as errored."""
        self.steps[index]["status"] = "error"
        if message:
            self.steps[index]["error"] = message
        if self.refresh_callback:
            self.refresh_callback()
    
    def skip(self, index: int):
        """Mark a step as skipped."""
        self.steps[index]["status"] = "skipped"
        if self.refresh_callback:
            self.refresh_callback()
    
    def render(self) -> Tree:
        """Render the progress tree with status symbols."""
        tree = Tree(f"[bold]{self.title}[/bold]")
        
        status_symbols = {
            "pending": "⏸ ",
            "running": "▶ ",
            "complete": "✓",
            "error": "✗",
            "skipped": "○",
        }
        
        status_colors = {
            "pending": "dim",
            "running": "cyan",
            "complete": "green",
            "error": "red",
            "skipped": "yellow",
        }
        
        for step in self.steps:
            status = step["status"]
            symbol = status_symbols.get(status, "?")
            color = status_colors.get(status, "white")
            name = step["name"]
            
            if status == "error" and "error" in step:
                tree.add(f"[{color}]{symbol} {name}: {step['error']}[/{color}]")
            else:
                tree.add(f"[{color}]{symbol} {name}[/{color}]")
        
        return tree


def select_with_arrows(options: Dict[str, str], prompt: str = "Select an option:") -> str:
    """Interactive arrow-key selection (T007)."""
    keys = list(options.keys())
    selected_index = 0
    
    def render_options():
        """Render the selection menu."""
        lines = [f"[bold]{prompt}[/bold]\n"]
        for i, key in enumerate(keys):
            arrow = "▶ " if i == selected_index else "  "
            style = "cyan bold" if i == selected_index else ""
            lines.append(f"{arrow}[{style}]{options[key]}[/{style}]")
        lines.append("\n[dim]Use ↑/↓ arrows to navigate, Enter to select, ESC to cancel[/dim]")
        return "\n".join(lines)
    
    with Live(render_options(), console=console, refresh_per_second=4) as live:
        while True:
            char = readkey()
            
            if char == key.UP:
                selected_index = (selected_index - 1) % len(keys)
                live.update(render_options())
            elif char == key.DOWN:
                selected_index = (selected_index + 1) % len(keys)
                live.update(render_options())
            elif char == key.ENTER:
                console.print()  # Add newline after selection
                return keys[selected_index]
            elif char == key.ESC or char == '\x03':  # ESC or Ctrl+C
                console.print("\n[yellow]Selection cancelled[/yellow]")
                raise typer.Exit(1)
            
            live.update(render_options())


def generate_checksum(file_path: Path) -> str:
    """Generate SHA-256 checksum for a file (T008)."""
    sha256_hash = hashlib.sha256()
    try:
        with open(file_path, "rb") as f:
            # Read in 8KB chunks for memory efficiency
            for byte_block in iter(lambda: f.read(8192), b""):
                sha256_hash.update(byte_block)
        return sha256_hash.hexdigest()
    except FileNotFoundError:
        raise FileNotFoundError(f"File not found: {file_path}")
    except PermissionError:
        raise PermissionError(f"Permission denied: {file_path}")


def is_valid_checksum(checksum: str) -> bool:
    """Validate SHA-256 checksum format (T008)."""
    return bool(re.match(r'^[a-f0-9]{64}$', checksum, re.IGNORECASE))


def _github_token(cli_token: Optional[str] = None) -> Optional[str]:
    """Return sanitized GitHub token from CLI arg or environment."""
    token = (cli_token or os.getenv("GH_TOKEN") or os.getenv("GITHUB_TOKEN") or "").strip()
    return token or None


def _github_auth_headers(cli_token: Optional[str] = None) -> Dict[str, str]:
    """Build Authorization header if a GitHub token is available."""
    token = _github_token(cli_token)
    return {"Authorization": f"Bearer {token}"} if token else {}


def _parse_rate_limit_headers(headers: httpx.Headers) -> Dict[str, Any]:
    """Extract rate-limit metadata from GitHub responses."""
    info: Dict[str, Any] = {}
    if "X-RateLimit-Remaining" in headers:
        info["remaining"] = headers.get("X-RateLimit-Remaining")
    if "X-RateLimit-Reset" in headers:
        try:
            reset_epoch = int(headers.get("X-RateLimit-Reset", "0"))
            if reset_epoch:
                info["reset_time"] = datetime.fromtimestamp(reset_epoch)
        except ValueError:
            pass
    return info


def _format_rate_limit_error(status_code: int, headers: httpx.Headers, url: str) -> str:
    """Format a user-friendly message for GitHub API failures."""
    rate_info = _parse_rate_limit_headers(headers)
    lines = [f"GitHub API returned status {status_code} for {url}"]
    if rate_info:
        lines.append("")
        lines.append("Rate limit details:")
        if "remaining" in rate_info:
            lines.append(f"  Remaining: {rate_info['remaining']}")
        if "reset_time" in rate_info:
            reset_str = rate_info["reset_time"].astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")
            lines.append(f"  Resets at: {reset_str}")
        lines.append("")
    lines.append("Tip: set GH_TOKEN or GITHUB_TOKEN to increase GitHub API limits.")
    return "\n".join(lines)


# ============================================================================
# Download and Extract Functions
# ============================================================================

def fetch_latest_release(github_token: Optional[str] = None) -> Dict[str, Any]:
    """
    Fetch latest release information from GitHub API (T012).
    
    Includes retry logic with exponential backoff for network failures.
    """
    api_url = GITHUB_API_URL
    headers = _github_auth_headers(github_token)
    for attempt in range(1, RETRY_CONFIG["attempts"] + 1):
        try:
            with httpx.Client(timeout=RETRY_CONFIG["timeout"], follow_redirects=True) as client:
                response = client.get(api_url, headers=headers)
            
            if response.status_code != 200:
                message = _format_rate_limit_error(response.status_code, response.headers, api_url)
                raise RuntimeError(message)
            
            release_data = response.json()
            
            # Warn when rate limit is nearly exhausted
            remaining = response.headers.get("X-RateLimit-Remaining")
            if remaining and remaining.isdigit() and int(remaining) < 10:
                console.print(f"[yellow]Warning: GitHub API rate limit low ({remaining} remaining)[/yellow]")
            
            return release_data
                
        except Exception as e:
            if attempt < RETRY_CONFIG["attempts"]:
                delay = RETRY_CONFIG["delays"][attempt - 1]
                console.print(f"[yellow]Attempt {attempt} failed, retrying in {delay}s...[/yellow]")
                time.sleep(delay)
            else:
                raise Exception(f"Failed to fetch release after {RETRY_CONFIG['attempts']} attempts: {e}")


def _select_release_asset(release_data: Dict[str, Any]) -> Dict[str, Any]:
    """Pick the best release asset (zip) or fall back to zipball URL."""
    assets = release_data.get("assets", [])
    preferred = next((a for a in assets if a.get("name", "").endswith(".zip")), None)
    if preferred:
        return {
            "url": preferred.get("browser_download_url"),
            "name": preferred.get("name", "template.zip"),
            "size": preferred.get("size", 0),
            "source": "asset",
        }
    return {
        "url": release_data.get("zipball_url"),
        "name": f"{GITHUB_REPO_NAME}-{release_data.get('tag_name', 'latest')}.zip",
        "size": 0,
        "source": "zipball",
    }


def download_release_archive(
    release_data: Dict[str, Any],
    tracker: Optional[StepTracker] = None,
    github_token: Optional[str] = None,
    debug: bool = False,
) -> Dict[str, Any]:
    """
    Download template archive from the latest GitHub release (T013).
    
    Returns metadata including downloaded file path.
    """
    cache_dir = Path(user_cache_dir("apidog-test"))
    cache_dir.mkdir(parents=True, exist_ok=True)

    asset = _select_release_asset(release_data)
    download_url = asset.get("url")
    if not download_url:
        raise RuntimeError("No download URL found in release data")
    
    temp_file = cache_dir / asset["name"]
    
    for attempt in range(1, RETRY_CONFIG["attempts"] + 1):
        try:
            with httpx.Client(timeout=RETRY_CONFIG["timeout"], follow_redirects=True) as client:
                with client.stream("GET", download_url, headers=_github_auth_headers(github_token)) as response:
                    if response.status_code != 200:
                        error_msg = _format_rate_limit_error(response.status_code, response.headers, download_url)
                        if debug:
                            error_msg += f"\n\nResponse body (truncated 400):\n{response.text[:400]}"
                        raise RuntimeError(error_msg)

                    downloaded = 0
                    with open(temp_file, "wb") as f:
                        for chunk in response.iter_bytes(chunk_size=8192):
                            f.write(chunk)
                            downloaded += len(chunk)
                    break
                    
        except Exception as e:
            if temp_file.exists():
                temp_file.unlink()
            if attempt < RETRY_CONFIG["attempts"]:
                delay = RETRY_CONFIG["delays"][attempt - 1]
                time.sleep(delay)
            else:
                raise Exception(f"Failed to download template after {RETRY_CONFIG['attempts']} attempts: {e}")
    
    metadata = {
        "path": temp_file,
        "filename": asset["name"],
        "size": asset.get("size", downloaded),
        "release": release_data.get("tag_name", "unknown"),
        "source": asset.get("source", "unknown"),
    }
    return metadata


def extract_template(zip_path: Path, target_dir: Path, tracker: Optional[StepTracker] = None, keep_zip: bool = False) -> Path:
    """
    Extract template archive to target directory (T014).
    
    Supports two archive formats:
    1. Root-level format: scripts/, templates/, commands/ at archive root
    2. Nested format: .apidog/scripts/, .apidog/templates/, .apidog/ai-commands/
    
    Returns the path to the extracted root directory for further processing.
    """
    apidog_dir = target_dir / ".apidog"
    temp_extract_dir = target_dir / ".apidog-temp"
    
    try:
        # Extract to temporary directory
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(temp_extract_dir)
        
        # Check if single top-level directory exists (GitHub format)
        extracted_items = list(temp_extract_dir.iterdir())
        if len(extracted_items) == 1 and extracted_items[0].is_dir():
            # Flatten: move contents up one level
            nested_dir = extracted_items[0]
            for item in nested_dir.iterdir():
                shutil.move(str(item), str(temp_extract_dir / item.name))
            nested_dir.rmdir()
        
        # Now check which format we have
        # Format 1: scripts/, templates/, commands/ at root
        has_root_format = (
            (temp_extract_dir / "scripts").exists() or
            (temp_extract_dir / "templates").exists() or
            (temp_extract_dir / "commands").exists()
        )
        
        # Format 2: .apidog/ folder with nested structure
        has_nested_format = (temp_extract_dir / ".apidog").exists()
        
        if has_root_format:
            # Root format: create .apidog/ and copy folders
            apidog_dir.mkdir(parents=True, exist_ok=True)
            
            # Copy scripts/ → .apidog/scripts/
            if (temp_extract_dir / "scripts").exists():
                if (apidog_dir / "scripts").exists():
                    shutil.rmtree(apidog_dir / "scripts")
                shutil.copytree(temp_extract_dir / "scripts", apidog_dir / "scripts")
            
            # Copy templates/ → .apidog/templates/
            if (temp_extract_dir / "templates").exists():
                if (apidog_dir / "templates").exists():
                    shutil.rmtree(apidog_dir / "templates")
                shutil.copytree(temp_extract_dir / "templates", apidog_dir / "templates")
            
            # Keep temp_extract_dir for AI agent processing (will be cleaned up by caller)
            # Don't delete zip yet if keep_zip is True
            if not keep_zip and zip_path.exists():
                zip_path.unlink()
            return temp_extract_dir
            
        elif has_nested_format:
            # Nested format: copy entire .apidog/ folder
            source_apidog = temp_extract_dir / ".apidog"
            if apidog_dir.exists():
                shutil.rmtree(apidog_dir)
            shutil.copytree(source_apidog, apidog_dir)
            
            # Clean up temp directory for nested format
            if temp_extract_dir.exists():
                shutil.rmtree(temp_extract_dir)
            if not keep_zip and zip_path.exists():
                zip_path.unlink()
            return temp_extract_dir  # Return None since already cleaned up
            
        else:
            # Clean up on error
            if temp_extract_dir.exists():
                shutil.rmtree(temp_extract_dir)
            if not keep_zip and zip_path.exists():
                zip_path.unlink()
            raise Exception("Archive does not contain expected structure (scripts/, templates/, commands/ or .apidog/)")
    
    except Exception as e:
        # Clean up on any error
        if temp_extract_dir.exists():
            shutil.rmtree(temp_extract_dir)
        if not keep_zip and zip_path.exists():
            zip_path.unlink()
        raise


# ============================================================================
# AI Agent Integration
# ============================================================================

def prompt_ai_agent_selection() -> str:
    """
    Prompt user to select AI agent integration (T015).
    
    Uses interactive arrow-key selection. Returns selected agent key.
    """
    console.print("\n[bold cyan]Select AI Agent Integration[/bold cyan]\n")
    
    options = {
        agent_key: config["name"] 
        for agent_key, config in AGENT_CONFIG.items()
    }
    
    try:
        selected = select_with_arrows(options, "Which AI agent would you like to set up?")
        return selected
    except (KeyboardInterrupt, typer.Exit):
        console.print("\n[yellow]AI agent selection cancelled - skipping AI setup[/yellow]")
        return "none"


def create_ai_agent_folders(project_path: Path, selected_agent: str, extract_dir: Path, tracker: Optional[StepTracker] = None) -> None:
    """
    Create AI agent command folders and copy definition files (T016).
    
    Creates .cursor/commands/ for Cursor or .github/agents/ for Copilot.
    Supports two source formats:
    1. Root format: commands/*.md at extract_dir root
    2. Nested format: .apidog/ai-commands/{agent}/
    
    Skips if agent is 'none'.
    """
    if selected_agent == "none":
        return
    
    if selected_agent not in AGENT_CONFIG:
        console.print(f"[yellow]Warning: Unknown AI agent '{selected_agent}', skipping AI setup[/yellow]")
        return
    
    agent_config = AGENT_CONFIG[selected_agent]
    agent_folder = agent_config["folder"]
    
    if not agent_folder:
        return
    
    # Create agent folder
    agent_path = project_path / agent_folder
    agent_path.mkdir(parents=True, exist_ok=True)
    
    # Try to find commands in two locations:
    # 1. Root format: commands/ at extract root
    # 2. Nested format: .apidog/ai-commands/{agent}/
    
    source_commands = None
    
    # Check root format first
    root_commands = extract_dir / "commands"
    if root_commands.exists() and root_commands.is_dir():
        source_commands = root_commands
    else:
        # Check nested format
        apidog_dir = project_path / ".apidog"
        nested_commands = apidog_dir / "ai-commands" / selected_agent
        if nested_commands.exists() and nested_commands.is_dir():
            source_commands = nested_commands
    
    if source_commands:
        # Copy command files
        for command_file in source_commands.iterdir():
            if command_file.is_file():
                # For root format, copy all .md/.yml files
                # For nested format, copy all files (already in agent-specific folder)
                dest_file = agent_path / command_file.name
                shutil.copy2(command_file, dest_file)
    else:
        console.print(f"[yellow]Warning: No command templates found for {agent_config['name']}[/yellow]")


# ============================================================================
# Check and Version Commands
# ============================================================================

@app.command()
def check(verbose: bool = typer.Option(False, "--verbose", help="Show detailed information")):
    """
    Verify Apidog installation status (T030).
    
    Checks for .apidog folder, manifest, version file, and AI agent integrations.
    """
    cwd = Path.cwd()
    apidog_dir = cwd / ".apidog"
    
    tracker = StepTracker("Installation Status")
    
    # Check .apidog folder
    step_folder = tracker.add("Check .apidog folder")
    tracker.start(step_folder)
    if apidog_dir.exists():
        tracker.complete(step_folder)
    else:
        tracker.error(step_folder, "Not found")
    
    # Check AI agents
    step_cursor = tracker.add("Check Cursor integration")
    tracker.start(step_cursor)
    if (cwd / ".cursor/commands").exists():
        tracker.complete(step_cursor)
    else:
        tracker.skip(step_cursor)
    
    step_copilot = tracker.add("Check GitHub Copilot integration")
    tracker.start(step_copilot)
    if (cwd / ".github/agents").exists():
        tracker.complete(step_copilot)
    else:
        tracker.skip(step_copilot)
    
    tracker.show()
    
    if not apidog_dir.exists():
        console.print("\n[yellow]Apidog not initialized in this directory[/yellow]")
        console.print("Run: [cyan]apidog-test init .[/cyan]")


@app.command()
def version():
    """
    Display version information (T031).
    
    Shows CLI version, template version, and system information.
    """
    import platform
    
    table = Table(title="Apidog Test CLI - Version Information")
    table.add_column("Component", style="cyan")
    table.add_column("Version", style="green")
    
    table.add_row("CLI Version", __version__)
    
    # Check for installed template version
    cwd = Path.cwd()
    version_path = cwd / ".apidog" / ".version"
    if version_path.exists():
        try:
            with open(version_path) as f:
                version_data = json.load(f)
            table.add_row("Template Version", version_data.get("templateVersion", "unknown"))
            table.add_row("Installed At", version_data.get("installedAt", "unknown"))
        except Exception:
            table.add_row("Template Version", "[dim]not installed[/dim]")
    else:
        table.add_row("Template Version", "[dim]not installed[/dim]")
    
    table.add_row("Python Version", platform.python_version())
    table.add_row("Platform", platform.system())
    table.add_row("Architecture", platform.machine())
    
    console.print(table)
    console.print("\n[dim]Run 'apidog-test init .' to initialize[/dim]")


@app.command()
def convert(
    input_path: Path = typer.Argument(..., help="Path to scenario YAML file or directory"),
    output_file: Optional[Path] = typer.Option(None, "-o", "--output", help="Optional output path for a single file"),
    node_bin: str = typer.Option("node", "--node-bin", help="Node.js binary to use"),
):
    """
    Convert scenario YAML to Apidog JSON using the bundled Node.js script.
    Supports single files or a directory of *.yaml/*.yml files.
    """
    cwd = Path.cwd()
    script_path = cwd / ".apidog" / "scripts" / "convert_scenario.js"
    
    if not script_path.exists():
        console.print(Panel(
            "[red]convert_scenario.js not found.[/red]\n"
            "Run 'apidog-test init' to install scripts into .apidog/scripts/ before converting.",
            title="Missing Script",
            border_style="red"
        ))
        raise typer.Exit(1)
    
    if not input_path.exists():
        console.print(Panel(
            f"[red]Input not found:[/red] {input_path}",
            title="Invalid Input",
            border_style="red"
        ))
        raise typer.Exit(1)
    
    def run_conversion(src: Path, dest: Optional[Path]) -> None:
        args = [node_bin, str(script_path), str(src)]
        if dest:
            args.append(str(dest))
        try:
            subprocess.run(args, check=True)
        except FileNotFoundError:
            console.print(Panel(
                f"[red]Node.js not found: {node_bin}[/red]\nInstall Node.js or specify --node-bin with the correct binary.",
                title="Node Missing",
                border_style="red"
            ))
            raise typer.Exit(1)
        except subprocess.CalledProcessError as e:
            console.print(Panel(
                f"[red]Conversion failed for {src} (exit code {e.returncode})[/red]",
                title="Conversion Error",
                border_style="red"
            ))
            raise typer.Exit(1)
    
    if input_path.is_dir():
        if output_file:
            console.print(Panel(
                "[red]--output is only valid for single-file conversion[/red]",
                title="Invalid Option",
                border_style="red"
            ))
            raise typer.Exit(1)
        
        yaml_files = sorted(list(input_path.rglob("*.yaml")) + list(input_path.rglob("*.yml")))
        if not yaml_files:
            console.print(Panel(
                f"[yellow]No YAML files found under {input_path}[/yellow]",
                title="Nothing to Convert",
                border_style="yellow"
            ))
            raise typer.Exit(0)
        
        for file_path in yaml_files:
            console.print(f"[cyan]Converting[/cyan] {file_path}")
            run_conversion(file_path, None)
        
        console.print(Panel(
            f"[green]✓ Converted {len(yaml_files)} file(s)[/green]\nOutputs written to .apidog/temp/ (default behavior).",
            title="Convert Scenarios",
            border_style="green"
        ))
    else:
        run_conversion(input_path, output_file)
        output_msg = f"Output: {output_file}" if output_file else "Output written to .apidog/temp/ (default)"
        console.print(Panel(
            f"[green]✓ Conversion completed[/green]\n{output_msg}",
            title="Convert Scenario",
            border_style="green"
        ))


@app.command()
def compare(
    openapi: Path = typer.Argument(..., help="Path to OpenAPI JSON file"),
    test_cases_dir: Path = typer.Argument(..., help="Directory of scenario YAML files"),
    apidog_json: Optional[Path] = typer.Argument(None, help="Optional Apidog JSON file to improve mapping"),
    output_file: Optional[Path] = typer.Argument(None, help="Optional output JSON path for coverage report"),
    node_bin: str = typer.Option("node", "--node-bin", help="Node.js binary to use"),
):
    """
    Compare OpenAPI endpoints against test cases using the Node compare_endpoints.js script.
    """
    script_path = Path.cwd() / ".apidog" / "scripts" / "compare_endpoints.js"
    if not script_path.exists():
        console.print(Panel(
            "[red]compare_endpoints.js not found.[/red]\nRun 'apidog-test init' to install scripts into .apidog/scripts/ before comparing.",
            title="Missing Script",
            border_style="red"
        ))
        raise typer.Exit(1)
    
    args = [node_bin, str(script_path), str(openapi), str(test_cases_dir)]
    if apidog_json:
        args.append(str(apidog_json))
    if output_file:
        args.append(str(output_file))
    
    try:
        subprocess.run(args, check=True)
    except FileNotFoundError:
        console.print(Panel(
            f"[red]Node.js not found: {node_bin}[/red]\nInstall Node.js or specify --node-bin with the correct binary.",
            title="Node Missing",
            border_style="red"
        ))
        raise typer.Exit(1)
    except subprocess.CalledProcessError as e:
        console.print(Panel(
            f"[red]Comparison failed (exit code {e.returncode})[/red]",
            title="Comparison Error",
            border_style="red"
        ))
        raise typer.Exit(1)


@app.command()
def merge(
    input_folder: Path = typer.Argument(..., help="Folder containing converted Apidog JSON test cases"),
    output_file: Path = typer.Argument(..., help="Path to output Apidog JSON"),
    node_bin: str = typer.Option("node", "--node-bin", help="Node.js binary to use"),
):
    """
    Merge converted Apidog JSON test cases into a single Apidog collection file.
    """
    script_path = Path.cwd() / ".apidog" / "scripts" / "merge_test_cases.js"
    if not script_path.exists():
        console.print(Panel(
            "[red]merge_test_cases.js not found.[/red]\nRun 'apidog-test init' to install scripts into .apidog/scripts/ before merging.",
            title="Missing Script",
            border_style="red"
        ))
        raise typer.Exit(1)
    
    args = [node_bin, str(script_path), str(input_folder), str(output_file)]
    try:
        subprocess.run(args, check=True)
    except FileNotFoundError:
        console.print(Panel(
            f"[red]Node.js not found: {node_bin}[/red]\nInstall Node.js or specify --node-bin with the correct binary.",
            title="Node Missing",
            border_style="red"
        ))
        raise typer.Exit(1)
    except subprocess.CalledProcessError as e:
        console.print(Panel(
            f"[red]Merge failed (exit code {e.returncode})[/red]",
            title="Merge Error",
            border_style="red"
        ))
        raise typer.Exit(1)


@app.command()
def reverse(
    apidog_json: Path = typer.Argument(..., help="Path to Apidog JSON file to reverse-convert"),
    output_yaml: Optional[Path] = typer.Argument(None, help="Optional output YAML path"),
    node_bin: str = typer.Option("node", "--node-bin", help="Node.js binary to use"),
):
    """
    Reverse-convert Apidog JSON back into YAML using reverse_convert.js.
    """
    script_path = Path.cwd() / ".apidog" / "scripts" / "reverse_convert.js"
    if not script_path.exists():
        console.print(Panel(
            "[red]reverse_convert.js not found.[/red]\nRun 'apidog-test init' to install scripts into .apidog/scripts/ before reversing.",
            title="Missing Script",
            border_style="red"
        ))
        raise typer.Exit(1)
    
    args = [node_bin, str(script_path), str(apidog_json)]
    if output_yaml:
        args.append(str(output_yaml))
    
    try:
        subprocess.run(args, check=True)
    except FileNotFoundError:
        console.print(Panel(
            f"[red]Node.js not found: {node_bin}[/red]\nInstall Node.js or specify --node-bin with the correct binary.",
            title="Node Missing",
            border_style="red"
        ))
        raise typer.Exit(1)
    except subprocess.CalledProcessError as e:
        console.print(Panel(
            f"[red]Reverse conversion failed (exit code {e.returncode})[/red]",
            title="Reverse Error",
            border_style="red"
        ))
        raise typer.Exit(1)


# ============================================================================
# Init Command Implementation
# ============================================================================

@app.command()
def init(
    project_name: Optional[str] = typer.Argument(None, help="Project directory name"),
    ai: Optional[str] = typer.Option(None, "--ai", help="AI agent: cursor|copilot|none"),
    force: bool = typer.Option(False, "--force", help="Skip confirmations and overwrite existing files"),
    here: bool = typer.Option(False, "--here", help="Initialize in current directory"),
    local_template: Optional[str] = typer.Option(None, "--local-template", help="Path to local template zip file (for testing)"),
    github_token: Optional[str] = typer.Option(None, "--github-token", help="GitHub token to increase API limits (or set GH_TOKEN/GITHUB_TOKEN)"),
):
    """
    Initialize Apidog test infrastructure (T009).
    
    Downloads templates and scripts from GitHub, creates .apidog folder,
    and sets up AI agent command definitions.
    """
    try:
        # Validate arguments (T010)
        if project_name and here:
            console.print(Panel(
                "[red]Error: Cannot specify both project_name and --here flag[/red]",
                title="Invalid Arguments",
                border_style="red"
            ))
            raise typer.Exit(1)
        
        # Determine target directory (T010)
        if here or project_name == ".":
            target_dir = Path.cwd()
            project_name = target_dir.name
        elif project_name:
            target_dir = Path.cwd() / project_name
        else:
            console.print(Panel(
                "[red]Error: Must specify project_name or use --here flag[/red]",
                title="Missing Argument",
                border_style="red"
            ))
            raise typer.Exit(1)
        
        # Check if target directory exists and create if needed (T010)
        if not target_dir.exists():
            if not force:
                console.print(f"[cyan]Creating project directory: {target_dir}[/cyan]")
            target_dir.mkdir(parents=True, exist_ok=True)
        
        # Check for existing .apidog folder (T011)
        apidog_dir = target_dir / ".apidog"
        if apidog_dir.exists():
            if not force:
                # Count existing files
                existing_files = list(apidog_dir.rglob("*"))
                file_count = len([f for f in existing_files if f.is_file()])
                
                console.print(Panel(
                    f"[yellow]Warning: .apidog folder already exists with {file_count} files.[/yellow]\n\n"
                    f"This will overwrite existing templates and scripts.\n"
                    f"User-generated content in scenarios/ will be preserved.\n\n"
                    f"Use --force to skip this confirmation.",
                    title="Existing Installation Detected",
                    border_style="yellow"
                ))
                
                confirm = typer.confirm("Continue with initialization?", default=False)
                if not confirm:
                    console.print("[yellow]Initialization cancelled[/yellow]")
                    raise typer.Exit(0)
        
        # Initialize tracker
        tracker = StepTracker("Initializing Apidog Test Infrastructure")
        
        # Add all steps
        step_fetch = tracker.add("Fetching latest release from GitHub")
        step_download = tracker.add("Downloading templates")
        step_extract = tracker.add("Extracting templates")
        step_ai = tracker.add("Setting up AI agent integration")
        # Perform initialization
        with Live(tracker.render(), console=console, refresh_per_second=4) as live:
            tracker.refresh_callback = live.refresh
            
            # Check if using local template for testing
            if local_template:
                # Skip fetch and download, use local file
                tracker.start(step_fetch)
                tracker.skip(step_fetch)
                tracker.start(step_download)
                tracker.skip(step_download)
                temp_zip = Path(local_template)
                if not temp_zip.exists():
                    raise Exception(f"Local template file not found: {local_template}")
                release_data = {"tag_name": "local-test", "name": "Local Template"}
            else:
                # T012: Fetch latest release
                tracker.start(step_fetch)
                release_data = fetch_latest_release(github_token=github_token)
                tracker.complete(step_fetch)
                
                # T013: Download templates
                tracker.start(step_download)
                download_meta = download_release_archive(
                    release_data,
                    tracker=tracker,
                    github_token=github_token,
                )
                temp_zip = download_meta["path"]
                tracker.complete(step_download)
            
            # T014: Extract templates
            tracker.start(step_extract)
            extract_dir = extract_template(temp_zip, target_dir, tracker, keep_zip=bool(local_template))
            tracker.complete(step_extract)
            
            # T015-T016: AI agent setup
            tracker.start(step_ai)
            selected_agent = ai if ai else prompt_ai_agent_selection()
            create_ai_agent_folders(target_dir, selected_agent, extract_dir, tracker)
            tracker.complete(step_ai)
            
            # Clean up temporary extraction directory (for root format)
            if extract_dir and extract_dir.exists() and extract_dir.name == ".apidog-temp":
                shutil.rmtree(extract_dir)
            
            # Create required subfolders in .apidog
            for subfolder in ["collections", "openapi", "temp", "test-case"]:
                subdir = apidog_dir / subfolder
                subdir.mkdir(parents=True, exist_ok=True)
            # Show help instructions after init
            help_text = """
[bold cyan]Apidog Test Workflow[/bold cyan]

[bold]Folder Structure:[/bold]
- collections/: input/output Apidog JSON
- openapi/: OpenAPI JSON files
- temp/: Temporary scenario files
- test-case/: Test cases per OpenAPI project

[bold]How to Use:[/bold]
1. Copy openapi.json to .apidog/openapi/
2. Export Apidog and copy to .apidog/collections/input/
3. Use /apidog.analyze in agent chat to analyze missing endpoints in test case
4. Use /apidog.generate to generate test case based on analyze
5. Run: node .apidog/scripts/convert_scenario.js to convert scenario test to Apidog JSON
6. Run: node .apidog/scripts/merge_test_cases.js to merge test cases to .apidog/collections/output/apidog.json
7. Import apidog.json to Apidog to test scenario

[Tip] Make sure Node.js is installed to use the scripts in .apidog/scripts/.
"""
            console.print(Panel(help_text, title="Apidog Test Usage", border_style="cyan"))
            # ...existing code...
        
        # T019: Display next steps
        show_next_steps(project_name, selected_agent, target_dir)
        
    except Exception as e:
        # T020: Error handling and rollback
        # Clean up temp directory if it exists
        if 'extract_dir' in locals() and extract_dir and extract_dir.exists() and extract_dir.name == ".apidog-temp":
            shutil.rmtree(extract_dir)
        handle_init_error(target_dir if 'target_dir' in locals() else None, e)
        raise typer.Exit(1)


def show_next_steps(project_name: str, selected_agent: str, project_path: Path) -> None:
    """
    Display next steps panel after successful initialization (T019).
    Shows different instructions based on selected AI agent.
    """
    agent_instructions = ""
    if selected_agent == "cursor":
        agent_instructions = """
[bold cyan]Using Cursor AI:[/bold cyan]
  1. Open this project in Cursor editor
  2. Use custom commands in .cursor/commands/
  3. Try: Ask Cursor to generate tests from your OpenAPI file
"""
    elif selected_agent == "copilot":
        agent_instructions = """
[bold cyan]Using GitHub Copilot:[/bold cyan]
  1. Open this project in VS Code
  2. Use custom commands in .github/agents/
  3. Try: Ask Copilot to generate tests from your OpenAPI file
"""
    else:
        agent_instructions = """
No AI agent selected:
  You can add AI integration later by re-running:
  apidog-test init . --ai cursor
  apidog-test init . --ai copilot
"""
    panel = Panel(
        f"[bold green]✓ Apidog Test Infrastructure Initialized![/bold green]\n\n"
        f"Project: {project_name}\n"
        f"Location: {project_path}\n\n"
        f"{agent_instructions}\n\n"
        f"Available Commands:\n  apidog-test check    - Verify installation\n  apidog-test version  - Show version info\n  apidog-test update   - Update templates (coming soon)\n\n"
        f"Folder Structure:\n  .apidog/templates/  - Test scenario templates\n  .apidog/scripts/    - Helper scripts\n  .apidog/scenarios/  - Your generated tests (create this)\n\n"
        f"[yellow]Reminder: To use scripts in .apidog/scripts/, you need to have Node.js installed.[/yellow]\n\n"
        f"Next: Use your AI agent to generate test scenarios from OpenAPI specs!\n",
        title="Apidog Test Initialized",
        border_style="green"
    )
    console.print(panel)

def handle_init_error(target_dir: Path, error: Exception) -> None:
    """
    Rollback and display error panel (T020).
    Removes .apidog folder if partially created.
    """
    if target_dir:
        apidog_dir = target_dir / ".apidog"
        if apidog_dir.exists():
            shutil.rmtree(apidog_dir)
    panel = Panel(
        f"[red]Initialization failed: {error}[/red]\n\n"
        f"Any partial files have been removed. Please try again or report the issue.",
        title="Error",
        border_style="red"
    )
    console.print(panel)


def main():
    """Entry point for the CLI application."""
    app()


if __name__ == "__main__":
    main()
