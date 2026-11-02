import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { App } from '../app/App';

const lecturer = { id: 'lecturer-id', displayName: 'Nneka Okafor', email: 'nneka@example.edu', role: 'LECTURER', verificationStatus: 'APPROVED', createdAt: '2026-11-02T12:00:00Z' };
const student = { ...lecturer, id: 'student-id', role: 'STUDENT', verificationStatus: null };
const course = { id: 'course-id', title: 'Cell biology', code: 'BIO 201', description: 'The study of living cells.', revision: 0, archivedAt: null, enrollmentEnabled: true };
const quiz = { id: 'assessment-id', title: 'Cells assessment', description: '', mode: 'ASSESSMENT', status: 'PUBLISHED', revision: 1, timeLimitSeconds: 600, questionCount: 1, courseId: course.id, opensAt: null, closesAt: '2026-11-02T14:00:00Z', closedAt: null, maxAttempts: 1 };
const json = (value: unknown, status=200) => new Response(JSON.stringify(value), {status,headers:{'Content-Type':'application/json'}});
function open(path: string, user: typeof lecturer | typeof student, handler: (path:string, init?:RequestInit)=>Response|Promise<Response>) {
  const fetchMock=vi.fn().mockImplementation((path:string,init?:RequestInit)=>Promise.resolve(path.endsWith('/auth/me')?json({user}):handler(path,init)));
  vi.stubGlobal('fetch',fetchMock);
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><App/></MemoryRouter></QueryClientProvider>);
  return fetchMock;
}
afterEach(()=>vi.unstubAllGlobals());
describe('courses and official assessments interface',()=>{
  it('explains lecturer verification before showing course management',async()=>{
    const fetchMock=open('/courses/new',{...lecturer,verificationStatus:'PENDING'},()=>json({}));
    expect(await screen.findByRole('heading',{name:'Lecturer verification required'})).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'View verification status'})).toHaveAttribute('href','/verification');
    expect(fetchMock.mock.calls.some(call=>call[0].includes('/courses'))).toBe(false);
  });
  it('shows student course navigation with a join action',async()=>{
    open('/courses',student,()=>json({courses:[course],total:1}));
    expect(await screen.findByRole('link',{name:'Cell biology'})).toBeInTheDocument();
    expect(screen.getByRole('link',{name:/Join a course/})).toHaveAttribute('href','/courses/join');
    expect(screen.queryByRole('link',{name:/Create course/})).not.toBeInTheDocument();
  });
  it('creates a course and displays its newly generated enrollment code',async()=>{
    const code='A'.repeat(24);
    const fetchMock=open('/courses/new',lecturer,(path,init)=>json(path==='/api/v1/courses'&&init?.method==='POST'?{...course,enrollmentCode:code}:path.includes('/assessments')?{assessments:[],total:0,serverNow:'2026-11-02T12:00:00Z'}:course));
    await screen.findByRole('heading',{name:'Create a course'});
    await userEvent.type(screen.getByLabelText('Course title'),course.title);
    await userEvent.type(screen.getByLabelText('Course code'),course.code);
    await userEvent.click(screen.getByRole('button',{name:'Create course'}));
    expect(await screen.findByText(code)).toBeInTheDocument();
    const call=fetchMock.mock.calls.find(call=>call[0]==='/api/v1/courses'&&call[1]?.method==='POST');
    expect(JSON.parse(call![1].body).title).toBe(course.title);
  });
  it('joins with an enrollment code and opens the enrolled course',async()=>{
    const fetchMock=open('/courses/join',student,path=>json(path.includes('/assessments')?{assessments:[quiz],total:1,serverNow:'2026-11-02T12:00:00Z'}:course));
    await screen.findByRole('heading',{name:'Join a course'});
    await userEvent.type(screen.getByLabelText('Enrollment code'),'B'.repeat(24));
    await userEvent.click(screen.getByRole('button',{name:'Join course'}));
    expect(await screen.findByRole('heading',{name:'Cell biology'})).toBeInTheDocument();
    expect(screen.getByRole('link',{name:/Assessment details/})).toHaveAttribute('href','/assessments/assessment-id');
    const call=fetchMock.mock.calls.find(call=>call[0].endsWith('/join')); expect(JSON.parse(call![1].body).code).toBe('B'.repeat(24));
  });
  it('shows enrollment errors without removing a student from the roster',async()=>{
    vi.spyOn(window,'confirm').mockReturnValue(true);
    open('/courses/course-id/roster',lecturer,(path,init)=>init?.method==='POST'?json({error:{message:'Finish active course attempts before changing enrollment.'}},409):json(path.endsWith('/roster?page=1')?{students:[{id:'student-id',displayName:'Ada Okoro',email:'ada@example.edu',status:'ACTIVE',joinedAt:'2026-11-02T12:00:00Z'}],total:1,active:1}:course));
    await screen.findByRole('button',{name:'Remove student'});
    await userEvent.click(screen.getByRole('button',{name:'Remove student'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Finish active course attempts');
    expect(screen.getByText('Ada Okoro')).toBeInTheDocument();
  });
  it('reuses the question editor with assessment scheduling and attempt limits',async()=>{
    const fetchMock=open('/courses/course-id/assessments/new',lecturer,(path,init)=>json(path.endsWith('/draft')?{...quiz,status:'DRAFT',questions:[]}:init?.method==='POST'?{...quiz,...JSON.parse(String(init.body)),status:'DRAFT',revision:0}:{assessments:[],total:0}));
    await screen.findByRole('heading',{name:'Create an assessment'});
    expect(screen.getByLabelText(/Closing date and time/)).toHaveAttribute('type','datetime-local');
    await userEvent.type(screen.getByLabelText('Quiz title'),quiz.title);
    await userEvent.clear(screen.getByLabelText('Maximum attempts'));
    await userEvent.type(screen.getByLabelText('Maximum attempts'),'2');
    await userEvent.click(screen.getByRole('button',{name:'Save draft'}));
    expect(await screen.findByRole('heading',{name:'Edit assessment draft'})).toBeInTheDocument();
    const call=fetchMock.mock.calls.find(call=>call[0]==='/api/v1/courses/course-id/assessments');
    expect(JSON.parse(call![1].body).maxAttempts).toBe(2);
  });
  it('disables scheduled starts and links previously submitted assessment results',async()=>{
    open('/assessments/assessment-id',student,()=>json({...quiz,opensAt:'2026-11-02T13:00:00Z',serverNow:'2026-11-02T12:00:00Z',attempts:[{id:'attempt-id',status:'SUBMITTED',attemptNumber:1}]}));
    expect(await screen.findByRole('button',{name:/Start or resume assessment/})).toBeDisabled();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByRole('link',{name:/Attempt 1/})).toHaveAttribute('href','/attempts/attempt-id/result');
  });
  it('shows only a score summary before assessment answer review is released',async()=>{
    open('/attempts/attempt-id/result',student,()=>json({id:'attempt-id',quizId:quiz.id,courseId:course.id,mode:'ASSESSMENT',title:quiz.title,status:'SUBMITTED',attemptNumber:1,totalQuestions:1,correctAnswers:1,incorrectAnswers:0,percentage:100,durationSeconds:50,reviewAvailable:false,reviewReleaseAt:quiz.closesAt,questions:[]}));
    expect(await screen.findByText('100%')).toBeInTheDocument();
    expect(screen.getByRole('heading',{name:'Answer review opens after closure'})).toBeInTheDocument();
    expect(screen.queryByRole('heading',{name:'Question review'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Practise incorrect questions'})).not.toBeInTheDocument();
  });
  it('renders straightforward lecturer report statistics and student scores',async()=>{
    open('/courses/course-id/assessments/assessment-id/report',lecturer,()=>json({quiz,totalEnrolled:2,studentsAttempted:1,finalizedAttempts:1,averagePercentage:50,highestPercentage:50,lowestPercentage:50,attempts:[{id:'attempt-id',student:{id:'student-id',displayName:'Ada Okoro',email:'ada@example.edu'},attemptNumber:1,status:'SUBMITTED',score:1,totalQuestions:2,submittedAt:'2026-11-02T12:30:00Z'}],questions:[{id:'question-id',prompt:'Which organelle produces ATP?',correctCount:1,totalGraded:1}]}));
    expect(await screen.findByText('Ada Okoro')).toBeInTheDocument();
    expect(screen.getByRole('cell',{name:'1/2'})).toBeInTheDocument();
    expect(screen.getByText('1 / 1 correct')).toBeInTheDocument();
    expect(screen.getByText('50% / 50%')).toBeInTheDocument();
  });
});
