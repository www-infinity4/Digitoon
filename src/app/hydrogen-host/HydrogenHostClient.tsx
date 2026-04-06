"use client";

import { useState, useCallback } from "react";
import { Plus, Trash2, PhoneCall, Users, Info } from "lucide-react";
import EmojiIdentifier from "@/components/EmojiIdentifier";
import SignalVisualizer from "@/components/SignalVisualizer";
import type { ContactEntry } from "@/types";

const DEMO_CONTACTS: ContactEntry[] = [
  {
    id: "1",
    name: "Alice",
    emojiId: {
      blocks: ["😎", "🟦", "👌", "🟥", "🎷", "🟨", "♣️", "⬜"],
      userId: "alice",
      deviceName: "Alice Device",
      createdAt: "2026-01-01T00:00:00Z",
    },
    online: true,
    lastSeen: "now",
  },
  {
    id: "2",
    name: "Green Engineer",
    emojiId: {
      blocks: ["🛸", "🟦", "🌻", "🟨", "💃", "⬜", "🐴", "🟩"],
      userId: "green-engineer",
      deviceName: "Nature Device",
      createdAt: "2026-01-15T00:00:00Z",
    },
    online: true,
    lastSeen: "now",
  },
  {
    id: "3",
    name: "Bob",
    emojiId: {
      blocks: ["🔮", "🟥", "⚡", "🟦", "🎯", "🟨", "🦊", "⬜"],
      userId: "bob",
      deviceName: "Bob Device",
      createdAt: "2026-02-01T00:00:00Z",
    },
    online: false,
    lastSeen: "2h ago",
  },
];

export default function HydrogenHostClient() {
  const [signalActive, setSignalActive] = useState(false);
  const [contacts, setContacts] = useState<ContactEntry[]>(DEMO_CONTACTS);
  const [calling, setCalling] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const toggleSignal = useCallback(() => {
    setSignalActive((v) => !v);
  }, []);

  const callContact = useCallback(
    (id: string) => {
      if (!signalActive) {
        setCalling(null);
        return;
      }
      setCalling(id);
      setTimeout(() => setCalling(null), 3000);
    },
    [signalActive]
  );

  const addContact = useCallback(() => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setAddError("Please enter a name.");
      return;
    }
    if (trimmed.length > 40) {
      setAddError("Name must be 40 characters or fewer.");
      return;
    }
    setAddError(null);
    const randomBlocks = Array.from({ length: 8 }, (_, i) => {
      const emojis = ["🌟", "🟦", "🎸", "🟥", "🦋", "🟨", "🌊", "⬜", "🔥", "🟩"];
      return emojis[(i * 3 + trimmed.length * (i + 1)) % emojis.length];
    });
    const newContact: ContactEntry = {
      id: Date.now().toString(),
      name: trimmed,
      emojiId: {
        blocks: randomBlocks,
        userId: trimmed.toLowerCase().replace(/\s+/g, "-"),
        deviceName: `${trimmed}'s Device`,
        createdAt: new Date().toISOString(),
      },
      online: true,
      lastSeen: "just joined",
    };
    setContacts((prev) => [newContact, ...prev]);
    setNewName("");
  }, [newName]);

  const removeContact = useCallback((id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 py-16">
      {/* Header */}
      <section aria-labelledby="hh-heading" className="mb-12 text-center">
        <div
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-purple-500/40 bg-purple-900/20 text-sm text-purple-300 mb-6"
          role="note"
        >
          📡 Hydrogen Host Protocol v1.0
        </div>
        <h1
          id="hh-heading"
          className="text-4xl sm:text-5xl font-extrabold text-white mb-4"
        >
          Hydrogen Host
        </h1>
        <p className="text-purple-200/60 text-lg max-w-2xl mx-auto">
          Your free, decentralized communication identity. No phone number.
          No subscription. Just your emoji ID and a hydrogen signal.
        </p>
      </section>

      {/* Your ID + Signal */}
      <div className="grid md:grid-cols-2 gap-6 mb-12">
        <div>
          <EmojiIdentifier label="Your Device Identifier" size="lg" />
          <div className="mt-4 glass-card rounded-xl p-4 border border-cyan-800/30">
            <div className="flex items-start gap-3">
              <Info className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-purple-300/60 leading-relaxed">
                This 8-block emoji ID is your unique address on the Hydrogen
                network. Share it with anyone — they can use it to call you
                directly, peer-to-peer, for free. As the network grows, IDs
                extend to 12+ blocks automatically.
              </p>
            </div>
          </div>
        </div>

        <div className="glass-card rounded-2xl p-6 border border-purple-800/30">
          <h2 className="font-bold text-white mb-4 flex items-center gap-2">
            <span role="img" aria-label="Signal antenna">📡</span>
            Signal Generator
          </h2>
          <SignalVisualizer active={signalActive} height={180} />
          <button
            onClick={toggleSignal}
            className={`mt-4 w-full py-3 rounded-xl font-bold transition-all ${
              signalActive
                ? "bg-gradient-to-r from-red-600 to-red-700 text-white hover:from-red-500 hover:to-red-600"
                : "bg-gradient-to-r from-purple-600 to-cyan-600 text-white hover:from-purple-500 hover:to-cyan-500"
            }`}
            aria-pressed={signalActive}
            aria-label={
              signalActive
                ? "Deactivate hydrogen signal"
                : "Activate hydrogen signal generator"
            }
          >
            {signalActive ? "⛔ Stop Signal" : "⚡ Activate Signal"}
          </button>
          {!signalActive && (
            <p className="text-center text-xs text-purple-400/50 mt-2" role="note">
              Activate to make calls
            </p>
          )}
        </div>
      </div>

      {/* Contact directory */}
      <section aria-labelledby="contacts-heading">
        <div className="flex items-center justify-between mb-6">
          <h2
            id="contacts-heading"
            className="text-2xl font-bold text-white flex items-center gap-2"
          >
            <Users className="w-6 h-6 text-purple-400" aria-hidden="true" />
            Network Directory
          </h2>
          <span className="text-sm text-purple-400/60">
            {contacts.filter((c) => c.online).length} online
          </span>
        </div>

        {/* Add contact */}
        <div className="glass-card rounded-xl p-4 mb-6 border border-purple-800/30">
          <h3 className="text-sm font-semibold text-purple-300 mb-3">
            Add New Contact
          </h3>
          <div className="flex gap-2">
            <div className="flex-1">
              <label htmlFor="new-contact-name" className="sr-only">
                Contact name
              </label>
              <input
                id="new-contact-name"
                type="text"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setAddError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && addContact()}
                placeholder="Enter name…"
                maxLength={40}
                className="w-full px-4 py-2 rounded-lg bg-purple-900/30 border border-purple-700/40 text-white placeholder-purple-500/50 text-sm focus:outline-none focus:border-purple-500"
                aria-invalid={addError !== null}
                aria-describedby={addError ? "add-contact-error" : undefined}
              />
              {addError && (
                <p
                  id="add-contact-error"
                  className="text-xs text-red-400 mt-1"
                  role="alert"
                >
                  {addError}
                </p>
              )}
            </div>
            <button
              onClick={addContact}
              className="flex items-center gap-1 px-4 py-2 rounded-lg bg-purple-700/40 hover:bg-purple-600/40 text-purple-200 text-sm font-semibold transition-all"
              aria-label="Add contact to network directory"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Add
            </button>
          </div>
        </div>

        {/* Contact list */}
        {contacts.length === 0 ? (
          <div
            className="text-center py-12 text-purple-400/50"
            role="status"
            aria-label="No contacts in directory"
          >
            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" aria-hidden="true" />
            <p>No contacts yet. Add one above.</p>
          </div>
        ) : (
          <ul className="space-y-3" role="list" aria-label="Contact directory">
            {contacts.map((contact) => (
              <li
                key={contact.id}
                className="glass-card rounded-xl p-4 border border-purple-800/30 flex items-center gap-4"
              >
                {/* Online indicator */}
                <div
                  className={`w-3 h-3 rounded-full flex-shrink-0 ${
                    contact.online ? "bg-green-400" : "bg-gray-600"
                  }`}
                  aria-label={contact.online ? "Online" : "Offline"}
                  role="img"
                />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white text-sm">{contact.name}</p>
                  <div
                    className="flex gap-1 mt-1"
                    role="img"
                    aria-label={`Emoji identifier: ${contact.emojiId.blocks.join("")}`}
                  >
                    {contact.emojiId.blocks.map((b, i) => (
                      <span key={i} className="text-sm" aria-hidden="true">
                        {b}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-purple-400/50 mt-1">
                    Last seen: {contact.lastSeen}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => callContact(contact.id)}
                    disabled={!signalActive || !contact.online}
                    className={`flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                      signalActive && contact.online
                        ? calling === contact.id
                          ? "bg-green-600/40 text-green-300 animate-pulse"
                          : "bg-green-600/20 hover:bg-green-600/30 text-green-300"
                        : "bg-gray-700/20 text-gray-500 cursor-not-allowed"
                    }`}
                    aria-label={
                      !signalActive
                        ? `Call ${contact.name} — activate signal first`
                        : !contact.online
                        ? `${contact.name} is offline`
                        : calling === contact.id
                        ? `Calling ${contact.name}…`
                        : `Call ${contact.name}`
                    }
                    aria-disabled={!signalActive || !contact.online}
                  >
                    <PhoneCall className="w-3 h-3" aria-hidden="true" />
                    {calling === contact.id ? "Calling…" : "Call"}
                  </button>
                  <button
                    onClick={() => removeContact(contact.id)}
                    className="p-2 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-900/20 transition-all"
                    aria-label={`Remove ${contact.name} from directory`}
                  >
                    <Trash2 className="w-3 h-3" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
