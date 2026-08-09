import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';

export default function AgentExport() {
  const { runId } = useParams<{ runId: string }>();
  const [format, setFormat] = useState<'pdf'|'docx'>('pdf');
  const [type, setType] = useState<'resume'|'cover_letter'|'recruiter_email'>('resume');
  const [downloadUrl, setDownloadUrl] = useState('');
  const { data: run } = useQuery({ queryKey: ['run', runId], queryFn: () => api.agentRuns.get(runId!) });
  const exportMut = useMutation({
    mutationFn: () => api.resumes.export(run!.resumeId!, { format, type }),
    onSuccess: (data: any) => setDownloadUrl(data.downloadUrl),
  });

  return (
    <div>
      <div className="page-header"><h1 className="page-title">Export</h1><p className="page-sub">Step 6 of 6 — Download or share your resume</p></div>
      <div className="step-nav">
        {['Setup','Intelligence','Strategy','Build','Review','Export'].map((s,i) => (
          <React.Fragment key={s}><div className={`step-item ${i===5?'active':i<5?'done':''}`}><div className="step-num">{i<5?'✓':i+1}</div>{s}</div>{i<5&&<div className="step-divider"/>}</React.Fragment>
        ))}
      </div>
      <div style={{ maxWidth: 480 }}>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title" style={{ marginBottom: 14 }}>Export options</div>
          <div className="form-group"><label className="form-label">Format</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {['pdf','docx'].map(f => <button key={f} className={`btn btn-sm ${format===f?'btn-primary':'btn-ghost'}`} onClick={() => setFormat(f as any)}>{f.toUpperCase()}</button>)}
            </div>
          </div>
          <div className="form-group"><label className="form-label">Document type</label>
            <select value={type} onChange={e => setType(e.target.value as any)}>
              <option value="resume">Resume</option>
              <option value="cover_letter">Cover Letter</option>
              <option value="recruiter_email">Recruiter Email</option>
            </select>
          </div>
          <button className="btn btn-primary" disabled={exportMut.isPending || !run?.resumeId} onClick={() => exportMut.mutate()}>
            {exportMut.isPending ? 'Generating…' : `Generate ${format.toUpperCase()}`}
          </button>
          {downloadUrl && (
            <div className="success-msg" style={{ marginTop: 14 }}>
              <a href={downloadUrl} download className="btn btn-primary" style={{ marginTop: 8 }}>⇩ Download {format.toUpperCase()}</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
