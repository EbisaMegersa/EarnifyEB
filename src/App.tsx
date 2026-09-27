import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Wallet, 
  Clock, 
  CheckCircle, 
  Search, 
  PlusCircle, 
  MinusCircle, 
  Edit3, 
  Send, 
  Radio, 
  Database, 
  AlertTriangle, 
  HelpCircle, 
  ArrowUpRight, 
  FileText,
  Settings,
  User,
  X,
  Sparkles
} from 'lucide-react';

// Interfaces matching backend
interface BotStatus {
  botName: string;
  botId: number | null;
  connected: boolean;
  error: string | null;
  ownerId: number;
  loggerId: number;
  fSubCount: number;
  fSubIds: number[];
  mongoConnected: boolean;
  mode: string;
}

interface SummaryStats {
  totalUsers: number;
  totalBalance: number;
  totalReferrals: number;
  pendingCount: number;
  approvedCount: number;
  totalPendingAmount: number;
  totalApprovedAmount: number;
  latestUsers: UserProfile[];
}

interface UserProfile {
  ID: number;
  Referrer: number;
  ReferredUsers: number[];
  AccNo: number;
  Balance: number;
  firstName?: string;
  createdAt?: string;
}

interface Withdrawal {
  id: string;
  userId: number;
  firstName?: string;
  amount: number;
  accNo: number;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  updatedAt: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'withdrawals' | 'broadcast' | 'info'>('overview');
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search and filter states
  const [userSearch, setUserSearch] = useState('');
  const [withdrawalFilter, setWithdrawalFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  // Broadcast state
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastLoading, setBroadcastLoading] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<string | null>(null);

  // User details & modify balance state
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [balanceAction, setBalanceAction] = useState<'add' | 'remove'>('add');
  const [balanceAmount, setBalanceAmount] = useState('');
  const [balanceLoading, setBalanceLoading] = useState(false);

  // User edit account state
  const [editAccUser, setEditAccUser] = useState<UserProfile | null>(null);
  const [newAccNo, setNewAccNo] = useState('');
  const [accLoading, setAccLoading] = useState(false);

  // Pull all data
  const fetchData = async () => {
    setLoading(true);
    try {
      const [statusRes, statsRes, usersRes, withdrawalsRes] = await Promise.all([
        fetch('/api/status').then(r => { if (!r.ok) throw new Error(); return r.json(); }),
        fetch('/api/stats').then(r => { if (!r.ok) throw new Error(); return r.json(); }),
        fetch('/api/users').then(r => { if (!r.ok) throw new Error(); return r.json(); }),
        fetch('/api/withdrawals').then(r => { if (!r.ok) throw new Error(); return r.json(); })
      ]);

      setStatus(statusRes);
      setStats(statsRes);
      setUsers(usersRes);
      setWithdrawals(withdrawalsRes);
      setError(null);
    } catch (err: any) {
      console.error('Error fetching dashboard data:', err);
      setError('System is initializing... Connection to admin API is being established.');
      // Rapid retry on error to heal instantly once the server completes boot
      setTimeout(fetchData, 2500);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000); // refresh every 10s
    return () => clearInterval(interval);
  }, []);

  // Update Balance
  const handleUpdateBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !balanceAmount || isNaN(Number(balanceAmount))) return;
    
    setBalanceLoading(true);
    try {
      const res = await fetch(`/api/users/${selectedUser.ID}/balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(balanceAmount), action: balanceAction })
      });
      
      if (!res.ok) {
        const errData = await res.json();
        alert(errData.error || 'Failed to update balance');
        return;
      }

      await fetchData();
      setSelectedUser(null);
      setBalanceAmount('');
    } catch (err) {
      console.error(err);
      alert('Error updating user balance');
    } finally {
      setBalanceLoading(false);
    }
  };

  // Update Account Number
  const handleUpdateAccNo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editAccUser || !newAccNo || isNaN(Number(newAccNo))) return;

    setAccLoading(true);
    try {
      const res = await fetch(`/api/users/${editAccUser.ID}/accno`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accNo: Number(newAccNo) })
      });

      if (!res.ok) {
        const errData = await res.json();
        alert(errData.error || 'Failed to update account number');
        return;
      }

      await fetchData();
      setEditAccUser(null);
      setNewAccNo('');
    } catch (err) {
      console.error(err);
      alert('Error updating account number');
    } finally {
      setAccLoading(false);
    }
  };

  // Process Withdrawal Approval/Rejection
  const handleProcessWithdrawal = async (id: string, status: 'approved' | 'rejected') => {
    if (!confirm(`Are you sure you want to set this withdrawal request to ${status}?`)) return;

    try {
      const res = await fetch(`/api/withdrawals/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });

      if (!res.ok) {
        const errData = await res.json();
        alert(errData.error || 'Failed to update status');
        return;
      }

      fetchData();
    } catch (err) {
      console.error(err);
      alert('Error processing withdrawal request');
    }
  };

  // Trigger Broadcast
  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastMessage.trim()) return;

    setBroadcastLoading(true);
    setBroadcastResult(null);
    try {
      const res = await fetch('/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: broadcastMessage })
      });

      const data = await res.json();
      if (res.ok) {
        setBroadcastResult(`Success: ${data.message}`);
        setBroadcastMessage('');
      } else {
        setBroadcastResult(`Error: ${data.error}`);
      }
    } catch (err: any) {
      setBroadcastResult(`Failed: ${err.message}`);
    } finally {
      setBroadcastLoading(false);
    }
  };

  // Filtered lists
  const filteredUsers = users.filter(u => 
    u.ID.toString().includes(userSearch) || 
    (u.firstName || '').toLowerCase().includes(userSearch.toLowerCase()) ||
    (u.AccNo || '').toString().includes(userSearch)
  );

  const filteredWithdrawals = withdrawals.filter(w => 
    withdrawalFilter === 'all' ? true : w.status === withdrawalFilter
  );

  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100">
      
      {/* HEADER SECTION */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-500/15 p-2 rounded-xl text-emerald-400 border border-emerald-500/20">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-100 via-slate-200 to-emerald-400">
                EarnifyEB Admin Panel
              </h1>
              <p className="text-xs text-slate-400">Telegram Referral & Wallet Bot Management</p>
            </div>
          </div>

          {/* STATUS GRID */}
          <div className="flex flex-wrap items-center gap-4 text-xs">
            {/* BOT STATUS */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
              status?.connected 
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
            }`}>
              <Radio className={`w-3.5 h-3.5 ${status?.connected ? 'animate-pulse' : ''}`} />
              <span>Bot: {status?.connected ? `@${status.botName}` : 'Offline'}</span>
            </div>

            {/* DB STATUS */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
              status?.mongoConnected 
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
            }`}>
              <Database className="w-3.5 h-3.5" />
              <span>Database: {status?.mongoConnected ? 'MongoDB (Cloud)' : 'Local File Fallback'}</span>
            </div>

            {/* REFRESH BUTTON */}
            <button 
              onClick={fetchData} 
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 transition rounded-full border border-slate-700 text-slate-300 active:scale-95 cursor-pointer"
            >
              Sync Now
            </button>
          </div>
        </div>
      </header>

      {/* ERROR MESSAGE BAR */}
      {error && (
        <div className="bg-rose-500/10 border-b border-rose-500/20 text-rose-400 py-3 px-4 text-sm flex items-center justify-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        
        {/* TABS BUTTONS */}
        <div className="flex border-b border-slate-800 mb-8 overflow-x-auto gap-2">
          <button 
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition duration-200 cursor-pointer ${
              activeTab === 'overview' 
                ? 'border-emerald-500 text-emerald-400' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Overview
          </button>
          <button 
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition duration-200 cursor-pointer ${
              activeTab === 'users' 
                ? 'border-emerald-500 text-emerald-400' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Users Directory ({users.length})
          </button>
          <button 
            onClick={() => setActiveTab('withdrawals')}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition duration-200 cursor-pointer ${
              activeTab === 'withdrawals' 
                ? 'border-emerald-500 text-emerald-400' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Withdrawals Queue ({withdrawals.filter(w => w.status === 'pending').length} Pending)
          </button>
          <button 
            onClick={() => setActiveTab('broadcast')}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition duration-200 cursor-pointer ${
              activeTab === 'broadcast' 
                ? 'border-emerald-500 text-emerald-400' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Broadcast Notification
          </button>
          <button 
            onClick={() => setActiveTab('info')}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition duration-200 cursor-pointer ${
              activeTab === 'info' 
                ? 'border-emerald-500 text-emerald-400' 
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Bot Details & Help
          </button>
        </div>

        {loading && !stats && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm text-slate-400">Loading system parameters...</p>
          </div>
        )}

        {/* TAB CONTENTS */}

        {/* 1. OVERVIEW */}
        {activeTab === 'overview' && stats && (
          <div className="space-y-8">
            {/* STATS TILES */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Total Users</p>
                  <p className="text-3xl font-bold mt-1 text-slate-100">{stats.totalUsers}</p>
                </div>
                <div className="bg-slate-800 p-3 rounded-xl text-emerald-400">
                  <Users className="w-6 h-6" />
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Circulating Balance</p>
                  <p className="text-3xl font-bold mt-1 text-emerald-400">{stats.totalBalance.toFixed(2)}</p>
                </div>
                <div className="bg-slate-800 p-3 rounded-xl text-emerald-400">
                  <Wallet className="w-6 h-6" />
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Pending Requests</p>
                  <p className="text-3xl font-bold mt-1 text-amber-400">{stats.pendingCount}</p>
                  <p className="text-xs text-slate-500 mt-1">{stats.totalPendingAmount.toFixed(2)} tokens</p>
                </div>
                <div className="bg-slate-800 p-3 rounded-xl text-amber-400">
                  <Clock className="w-6 h-6" />
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Approved Requests</p>
                  <p className="text-3xl font-bold mt-1 text-emerald-400">{stats.approvedCount}</p>
                  <p className="text-xs text-slate-500 mt-1">{stats.totalApprovedAmount.toFixed(2)} tokens</p>
                </div>
                <div className="bg-slate-800 p-3 rounded-xl text-emerald-400">
                  <CheckCircle className="w-6 h-6" />
                </div>
              </div>

            </div>

            {/* TWO COLUMN CONTENT */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
              {/* LATEST REGISTRATIONS (2 Cols) */}
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-bold">Latest User Registrations</h3>
                  <button 
                    onClick={() => setActiveTab('users')} 
                    className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                  >
                    View All Users <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 text-xs">
                        <th className="pb-3">User</th>
                        <th className="pb-3">User ID</th>
                        <th className="pb-3">Balance</th>
                        <th className="pb-3">Joined Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {stats.latestUsers.map(user => (
                        <tr key={user.ID} className="hover:bg-slate-800/40">
                          <td className="py-3 font-semibold text-slate-200">
                            {user.firstName || 'Unnamed User'}
                          </td>
                          <td className="py-3 font-mono text-xs text-slate-400">{user.ID}</td>
                          <td className="py-3 text-emerald-400 font-semibold">{user.Balance.toFixed(2)}</td>
                          <td className="py-3 text-xs text-slate-500">
                            {user.createdAt ? new Date(user.createdAt).toLocaleString() : 'N/A'}
                          </td>
                        </tr>
                      ))}
                      {stats.latestUsers.length === 0 && (
                        <tr>
                          <td colSpan={4} className="text-center py-6 text-slate-500">No registered users yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* QUICK CONFIG DETAILS (1 Col) */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
                <h3 className="text-lg font-bold">Bot Variables</h3>
                
                <div className="space-y-4 text-sm">
                  <div className="border-b border-slate-800 pb-3">
                    <p className="text-xs text-slate-400">Owner ID</p>
                    <p className="font-mono mt-0.5 text-slate-200">{status?.ownerId || 'Not Configured'}</p>
                  </div>
                  <div className="border-b border-slate-800 pb-3">
                    <p className="text-xs text-slate-400">Logger Chat ID</p>
                    <p className="font-mono mt-0.5 text-slate-200">{status?.loggerId || 'Not Configured'}</p>
                  </div>
                  <div className="border-b border-slate-800 pb-3">
                    <p className="text-xs text-slate-400">Forced Subscription Channel IDs</p>
                    <p className="font-mono mt-0.5 text-slate-200">
                      {status?.fSubIds && status.fSubIds.length > 0 
                        ? status.fSubIds.join(', ') 
                        : 'No mandatory subscription channels'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Operational Mode</p>
                    <p className="mt-0.5 text-slate-200 font-semibold">{status?.mode}</p>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* 2. USERS DIRECTORY */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            
            {/* SEARCH AND CONTROL BAR */}
            <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-slate-900 border border-slate-800 p-4 rounded-xl">
              <div className="relative w-full md:w-96">
                <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input 
                  type="text"
                  placeholder="Search user ID, name, or account..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 pl-10 pr-4 py-2 rounded-lg text-sm text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <span className="text-xs text-slate-400 shrink-0">
                Found {filteredUsers.length} users
              </span>
            </div>

            {/* USERS TABLE */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-800/40 text-slate-400 text-xs">
                      <th className="py-4 px-6">Name / Details</th>
                      <th className="py-4 px-6">User ID</th>
                      <th className="py-4 px-6">Referrer ID</th>
                      <th className="py-4 px-6">Account Number</th>
                      <th className="py-4 px-6">Referred Users</th>
                      <th className="py-4 px-6">Balance</th>
                      <th className="py-4 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredUsers.map(user => (
                      <tr key={user.ID} className="hover:bg-slate-800/20">
                        <td className="py-4 px-6">
                          <div>
                            <p className="font-semibold text-slate-200">{user.firstName || 'Unnamed'}</p>
                            <p className="text-xs text-slate-500">
                              Joined: {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
                            </p>
                          </div>
                        </td>
                        <td className="py-4 px-6 font-mono text-xs text-slate-400">{user.ID}</td>
                        <td className="py-4 px-6 font-mono text-xs text-slate-400">
                          {user.Referrer || <span className="text-slate-600">-</span>}
                        </td>
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-xs text-slate-300">
                              {user.AccNo || <span className="text-slate-600">Not Set</span>}
                            </span>
                            <button 
                              onClick={() => { setEditAccUser(user); setNewAccNo(user.AccNo ? String(user.AccNo) : ''); }}
                              className="text-slate-500 hover:text-emerald-400 p-1"
                              title="Set/Update account number"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                        <td className="py-4 px-6">
                          <span className="bg-slate-800 text-slate-300 text-xs px-2.5 py-1 rounded-full border border-slate-700">
                            {user.ReferredUsers ? user.ReferredUsers.length : 0} users
                          </span>
                        </td>
                        <td className="py-4 px-6 font-bold text-emerald-400">
                          {user.Balance.toFixed(2)}
                        </td>
                        <td className="py-4 px-6 text-right">
                          <div className="flex justify-end gap-2">
                            <button 
                              onClick={() => { setSelectedUser(user); setBalanceAction('add'); }}
                              className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white px-2.5 py-1 text-xs rounded-lg transition border border-emerald-500/20 cursor-pointer flex items-center gap-1"
                            >
                              <PlusCircle className="w-3 h-3" /> Add
                            </button>
                            <button 
                              onClick={() => { setSelectedUser(user); setBalanceAction('remove'); }}
                              className="bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white px-2.5 py-1 text-xs rounded-lg transition border border-rose-500/20 cursor-pointer flex items-center gap-1"
                            >
                              <MinusCircle className="w-3 h-3" /> Deduct
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center py-10 text-slate-500">No users found matching query.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 3. WITHDRAWALS QUEUE */}
        {activeTab === 'withdrawals' && (
          <div className="space-y-6">
            
            {/* FILTER BUTTONS */}
            <div className="flex gap-2 bg-slate-900 border border-slate-800 p-2 rounded-xl self-start w-fit">
              {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setWithdrawalFilter(f)}
                  className={`px-4 py-1.5 text-xs font-semibold rounded-lg capitalize transition cursor-pointer ${
                    withdrawalFilter === f 
                      ? 'bg-slate-800 text-slate-100 border border-slate-700' 
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>

            {/* WITHDRAWALS TABLE */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-800/40 text-slate-400 text-xs">
                      <th className="py-4 px-6">User / Details</th>
                      <th className="py-4 px-6">Account Number</th>
                      <th className="py-4 px-6">Requested Amount</th>
                      <th className="py-4 px-6">Request Date</th>
                      <th className="py-4 px-6">Status</th>
                      <th className="py-4 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredWithdrawals.map(w => (
                      <tr key={w.id} className="hover:bg-slate-800/20">
                        <td className="py-4 px-6">
                          <div>
                            <p className="font-semibold text-slate-200">{w.firstName || 'Unnamed User'}</p>
                            <p className="text-xs text-slate-400 font-mono">ID: {w.userId}</p>
                          </div>
                        </td>
                        <td className="py-4 px-6 font-mono text-xs text-slate-300">{w.accNo}</td>
                        <td className="py-4 px-6 font-bold text-slate-100">{w.amount.toFixed(2)} tokens</td>
                        <td className="py-4 px-6 text-xs text-slate-400">
                          {new Date(w.createdAt).toLocaleString()}
                        </td>
                        <td className="py-4 px-6">
                          <span className={`inline-block px-2.5 py-1 text-xs rounded-full font-semibold border ${
                            w.status === 'approved' 
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : w.status === 'rejected'
                              ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse'
                          }`}>
                            {w.status}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          {w.status === 'pending' ? (
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => handleProcessWithdrawal(w.id, 'approved')}
                                className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-3 py-1 text-xs rounded-lg transition cursor-pointer"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => handleProcessWithdrawal(w.id, 'rejected')}
                                className="bg-rose-500/15 hover:bg-rose-500 text-rose-400 hover:text-white border border-rose-500/25 px-3 py-1 text-xs rounded-lg transition cursor-pointer"
                              >
                                Reject (Refund)
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-500 text-xs font-semibold">Processed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredWithdrawals.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center py-10 text-slate-500">No withdrawal requests found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* 4. BROADCASTER */}
        {activeTab === 'broadcast' && (
          <div className="max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
            <div>
              <h3 className="text-lg font-bold">Broadcast Global Message</h3>
              <p className="text-xs text-slate-400 mt-1">
                Send a notification directly to all registered bot users simultaneously via Telegram.
              </p>
            </div>

            <form onSubmit={handleSendBroadcast} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase">Message Content (Markdown support)</label>
                <textarea 
                  rows={6}
                  placeholder="Type your message here... Use *bold* for bold text, _italic_ for italic, `code` for code snippets."
                  value={broadcastMessage}
                  onChange={(e) => setBroadcastMessage(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 p-4 rounded-xl text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-700 text-xs space-y-1.5 text-slate-400">
                <span className="font-semibold text-slate-200">Formatting Guides:</span>
                <p>• *This is bold text*</p>
                <p>• _This is italic text_</p>
                <p>• [Link Text](https://t.me/your_channel) to insert clickable URL</p>
              </div>

              {broadcastResult && (
                <div className={`p-4 rounded-xl text-sm ${
                  broadcastResult.startsWith('Success') 
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                }`}>
                  {broadcastResult}
                </div>
              )}

              <button
                type="submit"
                disabled={broadcastLoading || !broadcastMessage.trim()}
                className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:hover:bg-emerald-500 text-slate-950 font-bold py-3 rounded-xl transition cursor-pointer flex items-center justify-center gap-2"
              >
                {broadcastLoading ? 'Sending...' : (
                  <>
                    <Send className="w-4 h-4" /> Send Global Broadcast
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* 5. SYSTEM DETAILS & HELP */}
        {activeTab === 'info' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
            {/* INSTRUCTIONS */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <HelpCircle className="text-emerald-400 w-5 h-5" /> Telegram Bot Referral Manual
              </h3>
              
              <div className="text-sm text-slate-300 space-y-3 leading-relaxed">
                <p>
                  Welcome to <strong>EarnifyEB</strong>! This applet acts as a fully self-contained Node.js dashboard that keeps your Telegram bot alive while monitoring transaction activities.
                </p>
                <div className="border-l-2 border-emerald-500 pl-4 space-y-2">
                  <p className="font-semibold text-slate-100">Referral Multiplier:</p>
                  <p>When a new user launches the bot using a referral link (<code className="bg-slate-800 px-1 py-0.5 rounded font-mono text-xs">/start referrer_id</code>), the referrer is automatically credited with <strong>10.00 tokens</strong>.</p>
                </div>
                <div className="border-l-2 border-emerald-500 pl-4 space-y-2">
                  <p className="font-semibold text-slate-100">Channel Verification (fSub):</p>
                  <p>Forced subscriptions are supported. Users who have not joined specified channels will be prompted to do so before gaining access to the bot.</p>
                </div>
                <div className="border-l-2 border-emerald-500 pl-4 space-y-2">
                  <p className="font-semibold text-slate-100">Withdrawals Flow:</p>
                  <p>Users must set an account number (<code className="bg-slate-800 px-1 py-0.5 rounded font-mono text-xs">/accno</code>) and initiate withdrawal. The request is queued as pending, instantly alerting the admin in the Logger Chat and in this Web Dashboard, waiting for confirmation.</p>
                </div>
              </div>
            </div>

            {/* ARCHITECTURE DIAGRAM */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <FileText className="text-emerald-400 w-5 h-5" /> Environment Variables Setup
              </h3>
              
              <div className="space-y-4 text-xs">
                <p className="text-slate-400">Ensure the following keys are set up in your system environment:</p>
                <table className="w-full text-left font-mono border-collapse divide-y divide-slate-800">
                  <thead>
                    <tr className="text-slate-400 text-[10px]">
                      <th className="pb-2">Variable</th>
                      <th className="pb-2">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-300">
                    <tr>
                      <td className="py-2.5 font-bold text-slate-100">TOKEN</td>
                      <td className="py-2.5">Your official Telegram Bot token from @BotFather.</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 font-bold text-slate-100">OWNER_ID</td>
                      <td className="py-2.5">Your personal Telegram account ID. Needed for admin commands.</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 font-bold text-slate-100">LOGGER_ID</td>
                      <td className="py-2.5">Chat ID / Group Chat ID where withdrawal request buttons are sent.</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 font-bold text-slate-100">FSUB_IDS</td>
                      <td className="py-2.5">Forced subscription channel IDs (separated by commas).</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 font-bold text-slate-100">MONGO_URI</td>
                      <td className="py-2.5">MongoDB Connection String. Fallback active if unprovided.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

      </main>

      {/* MODALS / OVERLAYS */}

      {/* BALANCE ADJUSTMENT MODAL */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm px-4">
          <div className="bg-slate-900 border border-slate-800 max-w-md w-full rounded-2xl overflow-hidden shadow-2xl">
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-800 bg-slate-900/60">
              <h4 className="font-bold text-slate-100 capitalize">
                {balanceAction} Balance for {selectedUser.firstName || 'User'}
              </h4>
              <button onClick={() => setSelectedUser(null)} className="text-slate-400 hover:text-slate-200 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateBalance} className="p-6 space-y-4">
              <div>
                <p className="text-xs text-slate-400">Current Balance</p>
                <p className="text-lg font-bold text-emerald-400">{selectedUser.Balance.toFixed(2)} tokens</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  AMOUNT TO {balanceAction === 'add' ? 'CREDIT' : 'DEDUCT'}
                </label>
                <input 
                  type="number"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={balanceAmount}
                  onChange={(e) => setBalanceAmount(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 p-2.5 rounded-xl text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <button 
                type="submit" 
                disabled={balanceLoading || !balanceAmount}
                className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-950 font-bold py-2.5 rounded-xl transition cursor-pointer"
              >
                {balanceLoading ? 'Updating...' : `Confirm ${balanceAction === 'add' ? 'Addition' : 'Deduction'}`}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ACCOUNT NUMBER EDIT MODAL */}
      {editAccUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm px-4">
          <div className="bg-slate-900 border border-slate-800 max-w-md w-full rounded-2xl overflow-hidden shadow-2xl">
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-800 bg-slate-900/60">
              <h4 className="font-bold text-slate-100">Set Account Number</h4>
              <button onClick={() => setEditAccUser(null)} className="text-slate-400 hover:text-slate-200 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateAccNo} className="p-6 space-y-4">
              <div>
                <p className="text-xs text-slate-400">User ID</p>
                <p className="text-sm font-semibold font-mono text-slate-300">{editAccUser.ID}</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  ACCOUNT NUMBER
                </label>
                <input 
                  type="text"
                  required
                  pattern="\d+"
                  placeholder="E.g., 1002003004"
                  value={newAccNo}
                  onChange={(e) => setNewAccNo(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 p-2.5 rounded-xl text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <button 
                type="submit" 
                disabled={accLoading || !newAccNo}
                className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-950 font-bold py-2.5 rounded-xl transition cursor-pointer"
              >
                {accLoading ? 'Saving...' : 'Save Account Number'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="border-t border-slate-800 bg-slate-900/20 py-6 text-center text-xs text-slate-500">
        <p>© 2026 EarnifyEB. Running on Node.js 22 server. Port 3000 Active.</p>
      </footer>

    </div>
  );
}
