import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, LogOut, MessageSquare, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toUserMessage } from '@/lib/errors';
import { formatRelative } from '@/lib/format';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { Spinner } from '@/components/UI/Spinner';
import type { AdminStats, Message, Profile } from '@/types/chat';
import './AdminPage.scss';

const RECENT_LIMIT = 8;

export function AdminPage() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const { session, conversationId, signOut } = useAuth();

  const userId = session?.user?.id ?? '';

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [recent, setRecent] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!conversationId) return;

    setLoading(true);
    try {
      const [profilesResult, recentResult, allResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, role, display_name, created_at')
          .order('role', { ascending: true }),
        supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false })
          .limit(RECENT_LIMIT),
        // Only the columns the counters need, so this stays cheap.
        supabase
          .from('messages')
          .select('sender_id, created_at, read_at')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true }),
      ]);

      if (profilesResult.error) throw profilesResult.error;
      if (recentResult.error) throw recentResult.error;
      if (allResult.error) throw allResult.error;

      const all = (allResult.data ?? []) as Pick<
        Message,
        'sender_id' | 'created_at' | 'read_at'
      >[];

      const mine = all.filter((row) => row.sender_id === userId);
      const theirs = all.filter((row) => row.sender_id !== userId);

      setStats({
        totalMessages: all.length,
        myMessages: mine.length,
        theirMessages: theirs.length,
        firstMessageAt: all[0]?.created_at ?? null,
        lastMessageAt: all[all.length - 1]?.created_at ?? null,
        unreadFromThem: theirs.filter((row) => !row.read_at).length,
        participants: (profilesResult.data as Profile[] | null) ?? [],
      });

      setRecent((recentResult.data as Message[] | null) ?? []);
    } catch (error) {
      notify(toUserMessage(error, "Couldn't load the overview."), 'error');
    } finally {
      setLoading(false);
    }
  }, [conversationId, userId, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  return (
    <div className="admin">
      <header className="admin__header">
        <button
          type="button"
          className="admin__icon"
          onClick={() => navigate('/chat')}
          aria-label="Back to the chat"
        >
          <ChevronLeft size={22} aria-hidden="true" />
        </button>

        <h1 className="admin__title">Overview</h1>

        <button
          type="button"
          className="admin__icon"
          onClick={() => void load()}
          aria-label="Refresh the overview"
          disabled={loading}
        >
          <RefreshCw size={18} aria-hidden="true" />
        </button>
      </header>

      <div className="admin__body">
        {loading && !stats ? (
          <div className="admin__loading">
            <Spinner size={20} label="Loading overview" />
          </div>
        ) : !stats ? (
          <p className="admin__empty">Nothing to show yet.</p>
        ) : (
          <>
            <section className="admin__section" aria-labelledby="admin-counts">
              <h2 className="admin__section-title" id="admin-counts">
                This conversation
              </h2>
              <dl className="admin__stats">
                <div className="admin__stat">
                  <dt>Messages</dt>
                  <dd>{stats.totalMessages}</dd>
                </div>
                <div className="admin__stat">
                  <dt>Sent by you</dt>
                  <dd>{stats.myMessages}</dd>
                </div>
                <div className="admin__stat">
                  <dt>Received</dt>
                  <dd>{stats.theirMessages}</dd>
                </div>
                <div className="admin__stat">
                  <dt>Unread by you</dt>
                  <dd>{stats.unreadFromThem}</dd>
                </div>
              </dl>

              <p className="admin__meta">
                {stats.firstMessageAt
                  ? `Started ${formatRelative(stats.firstMessageAt)} · last message ${formatRelative(
                      stats.lastMessageAt ?? stats.firstMessageAt,
                    )}`
                  : 'No messages have been sent yet.'}
              </p>
            </section>

            <section className="admin__section" aria-labelledby="admin-people">
              <h2 className="admin__section-title" id="admin-people">
                People
              </h2>
              <ul className="admin__people">
                {stats.participants.map((participant) => (
                  <li className="admin__person" key={participant.id}>
                    <span className="admin__person-name">
                      {participant.display_name}
                      {participant.id === userId && (
                        <span className="admin__person-you"> · you</span>
                      )}
                    </span>
                    <span className="admin__person-role">{participant.role}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="admin__section" aria-labelledby="admin-recent">
              <h2 className="admin__section-title" id="admin-recent">
                Recent messages
              </h2>

              {recent.length === 0 ? (
                <p className="admin__empty">Nothing has been sent yet.</p>
              ) : (
                <ul className="admin__recent">
                  {recent.map((message) => (
                    <li className="admin__recent-item" key={message.id}>
                      <div className="admin__recent-head">
                        <span className="admin__recent-who">
                          {message.sender_id === userId
                            ? 'You'
                            : (stats.participants.find((p) => p.id === message.sender_id)
                                ?.display_name ?? 'Them')}
                        </span>
                        <span className="admin__recent-when">
                          {formatRelative(message.created_at)}
                        </span>
                      </div>
                      <p className="admin__recent-text">{message.content}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="admin__actions">
              <button
                type="button"
                className="admin__action"
                onClick={() => navigate('/chat')}
              >
                <MessageSquare size={17} aria-hidden="true" />
                Open the chat
              </button>
              <button
                type="button"
                className="admin__action admin__action--quiet"
                onClick={() => void handleSignOut()}
              >
                <LogOut size={17} aria-hidden="true" />
                Log out
              </button>
            </div>

            <p className="admin__note">
              Admin sees the same conversation with the same permissions. Messages the
              other person sent can be read here, never edited or deleted.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
