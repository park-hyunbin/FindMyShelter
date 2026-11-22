import { useEffect, useRef, useState, type FormEvent } from 'react';
import { answerTourQuestion, guideQuestions, type GuideAnswer, type GuideData } from './data/tour-guide-faq';

type Exchange = { question: string; answers: GuideAnswer[] };

export default function TourGuideChat({ data, complexName, onDismiss }: {
  data: GuideData; complexName: string; onDismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const messages = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [history, setHistory] = useState<Exchange[]>([]);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);

  useEffect(() => {
    if (messages.current) messages.current.scrollTop = messages.current.scrollHeight;
  }, [history]);

  function ask(text: string) {
    const question = text.trim();
    if (!question) return;
    setHistory(previous => [...previous.slice(-19), { question, answers: answerTourQuestion(question, data) }]);
    setDraft('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    ask(draft);
  }

  return <dialog ref={dialog} className="guide-chat" aria-labelledby="tour-guide-heading"
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
    onCancel={event => { event.preventDefault(); onDismiss(); }}>
    <header>
      <div><h2 id="tour-guide-heading">임장 안내원</h2><p>{complexName}</p></div>
      <button type="button" aria-label="안내원 대화 닫기" onClick={onDismiss} autoFocus>×</button>
    </header>
    <div className="guide-messages" role="log" aria-label="안내원 대화" ref={messages}>
      <p className="guide-answer">안녕하세요! 이 단지에서 궁금한 게 있나요? 제가 가진 자료를 찾아볼게요.</p>
      {history.map(({ question, answers }, index) => <div className="guide-exchange" key={index}>
        <p className="guide-question">{question}</p>
        {answers.map(({ text, sources }, i) => <div key={i} className="guide-answer">
          <p>{text}</p>
          {sources.length ? sources.map(source => <small key={source.url}>
            <a href={source.url} target="_blank" rel="noreferrer">{source.name} ↗</a>
            <span>{source.date ? `${source.date} 기준` : '기준일 미확인'}</span>
          </small>) : <small>출처와 기준일을 확인할 수 있는 자료가 없어요.</small>}
        </div>)}
      </div>)}
    </div>
    <div className="guide-prompts" aria-label="추천 질문">
      {guideQuestions.map(question => <button type="button" key={question} onClick={() => ask(question)}>{question}</button>)}
    </div>
    <form onSubmit={submit}>
      <input aria-label="안내원에게 물어볼 내용" placeholder="이 단지에 대해 물어보세요" maxLength={160}
        value={draft} onChange={event => setDraft(event.target.value)} />
      <button type="submit" disabled={!draft.trim()}>보내기</button>
    </form>
  </dialog>;
}
