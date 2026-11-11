"use client";

import { useState } from "react";
import { Board } from "@/components/board/board";
import { DrillProvider, useDrill } from "@/components/drill-context";
import { PinnedProvider, usePinned } from "@/components/board/pinned-provider";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChartNoAxesColumn, Database, Pin } from "lucide-react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ThemeToggle } from "@/components/theme-toggle";
import { Welcome, useWelcome } from "@/components/welcome";
import { welcomeStore } from "@/lib/welcome-store";
import { useMediaQuery } from "@/lib/use-media-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function Header() {
  const { pinned } = usePinned();
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4 sm:px-5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <ChartNoAxesColumn className="size-4" strokeWidth={2.5} />
        </span>
        <div className="leading-tight">
          <h1 className="text-sm font-semibold tracking-tight">AI Data Analyst</h1>
          <p className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
            <Database className="size-3" /> Snowflake · LOOKER.AI · read-only
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground sm:flex">
          <Pin className="size-3" />
          <span className="tabular-nums">{pinned.length}</span> pinned
        </span>
        <ThemeToggle />
      </div>
    </header>
  );
}

function Layout() {
  const desktop = useMediaQuery("(min-width: 768px)");
  const { pending } = useDrill();
  const [tab, setTab] = useState("chat");
  return (
    <div className="flex h-dvh flex-col">
      <Header />
      {/* Desktop: resizable split */}
      {desktop ? (
        <div className="min-h-0 flex-1">
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize="44%" minSize="30%">
              <div className="h-full bg-background">
                <ChatPanel />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle className="bg-border" />
            <ResizablePanel defaultSize="56%" minSize="30%">
              <div className="scroll-thin h-full overflow-y-auto bg-[color-mix(in_oklab,var(--muted)_55%,var(--background))]">
                <Board />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      ) : (
        // A pending drill-down always shows the chat so the answer is visible.
        <Tabs
          value={pending ? "chat" : tab}
          onValueChange={setTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="mx-4 mt-3 grid w-[calc(100%-2rem)] grid-cols-2">
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="board">Dashboard</TabsTrigger>
          </TabsList>
          <TabsContent value="chat" className="min-h-0 flex-1">
            <ChatPanel />
          </TabsContent>
          <TabsContent value="board" className="min-h-0 flex-1 overflow-y-auto">
            <Board />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

export default function Home() {
  const welcome = useWelcome();
  // Blank until the check runs, so returning visitors never see the welcome page flash by.
  if (welcome === "unknown") return <div className="h-dvh bg-background" />;
  if (welcome === "unseen") return <Welcome onContinue={welcomeStore.dismiss} />;
  return (
    <PinnedProvider>
      <DrillProvider>
        <Layout />
      </DrillProvider>
    </PinnedProvider>
  );
}
