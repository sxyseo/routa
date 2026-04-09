"use client";

import { DockerStatusIndicator } from "./docker-status-indicator";
import { SettingsPopupMenu } from "./settings-popup-menu";
import { McpStatusIndicator } from "./mcp-status-indicator";


interface ShellHeaderControlsProps {
  className?: string;
  showSettingsMenu?: boolean;
  compactStatus?: boolean;
}

export function ShellHeaderControls({
  className = "",
  showSettingsMenu = false,
  compactStatus = false,
}: ShellHeaderControlsProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="hidden lg:flex">
        <DockerStatusIndicator compact={compactStatus} />
      </div>
      <div className="hidden lg:flex">
        <McpStatusIndicator compact={compactStatus} />
      </div>
      {showSettingsMenu ? <SettingsPopupMenu showLabel position="topbar" buttonClassName="h-8 gap-1" /> : null}
    </div>
  );
}
