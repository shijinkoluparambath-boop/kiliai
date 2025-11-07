
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality, Type } from '@google/genai';
import { MicrophoneIcon, StopIcon, LoadingIcon, UploadIcon } from './components/Icons';
import { TranscriptionCard } from './components/TranscriptionCard';
import { createBlob } from './utils/audio';

type TranscriptionHistory = {
  user: string;
  translation: string;
};

const Header = React.memo(() => (
  <header className="w-full max-w-4xl mx-auto p-4 text-center">
    <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
      KILIAI
    </h1>
    <p className="mt-2 text-lg text-gray-400">
      AI-powered audio translation into Malayalam.
    </p>
  </header>
));

const App: React.FC = () => {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [isProcessingFile, setIsProcessingFile] = useState<boolean>(false);
  const [userTranscript, setUserTranscript] = useState<string>('');
  const [malayalamTranslation, setMalayalamTranslation] = useState<string>('');
  const [history, setHistory] = useState<TranscriptionHistory[]>([]);
  const [error, setError] = useState<string | null>(null);

  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentInputTranscriptionRef = useRef<string>('');
  const currentOutputTranscriptionRef = useRef<string>('');

  const stopRecording = useCallback(async () => {
    setIsRecording(false);
    setIsConnecting(false);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (scriptProcessorRef.current && audioContextRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    if (sessionPromiseRef.current) {
        try {
            const session = await sessionPromiseRef.current;
            session.close();
        } catch(e) {
            console.error("Error closing session:", e);
        }
        sessionPromiseRef.current = null;
    }

    if (currentInputTranscriptionRef.current || currentOutputTranscriptionRef.current) {
        setHistory(prev => [...prev, { user: currentInputTranscriptionRef.current, translation: currentOutputTranscriptionRef.current }]);
    }
    setUserTranscript('');
    setMalayalamTranslation('');
    currentInputTranscriptionRef.current = '';
    currentOutputTranscriptionRef.current = '';

  }, []);

  const startRecording = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    setUserTranscript('');
    setMalayalamTranslation('');
    
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsConnecting(false);
      setIsRecording(true);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      
      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            const source = audioContextRef.current.createMediaStreamSource(streamRef.current!);
            scriptProcessorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
            
            scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              if (sessionPromiseRef.current) {
                  sessionPromiseRef.current.then((session) => {
                    if (isRecording) {
                      session.sendRealtimeInput({ media: pcmBlob });
                    }
                  }).catch(e => {
                    console.error("Error sending audio data:", e);
                    setError("Failed to send audio data. Please try again.");
                    stopRecording();
                  });
              }
            };
            source.connect(scriptProcessorRef.current);
            scriptProcessorRef.current.connect(audioContextRef.current.destination);
          },
          onmessage: (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              currentInputTranscriptionRef.current += text;
              setUserTranscript(currentInputTranscriptionRef.current);
            }
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              currentOutputTranscriptionRef.current += text;
              setMalayalamTranslation(currentOutputTranscriptionRef.current);
            }
            if (message.serverContent?.turnComplete) {
              const fullInput = currentInputTranscriptionRef.current;
              const fullOutput = currentOutputTranscriptionRef.current;
              if (fullInput.trim() || fullOutput.trim()) {
                setHistory(prev => [...prev, { user: fullInput, translation: fullOutput }]);
              }
              setUserTranscript('');
              setMalayalamTranslation('');
              currentInputTranscriptionRef.current = '';
              currentOutputTranscriptionRef.current = '';
            }
          },
          onerror: (e: any) => {
            console.error('Session error:', e);
            setError(`An error occurred: ${e.message || 'Unknown error'}. Please try again.`);
            stopRecording();
          },
          onclose: () => {},
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: 'You are an expert translator. The user will speak in any language. Your task is to provide a translation in Malayalam of what the user says. You must only respond with the Malayalam translation.'
        },
      });

    } catch (err) {
      console.error("Failed to start recording:", err);
      setError("Could not access microphone. Please grant permission and try again.");
      setIsConnecting(false);
    }
  }, [isRecording, stopRecording]);


  const handleToggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            const base64Data = result.split(',')[1];
            resolve(base64Data);
        };
        reader.onerror = (error) => reject(error);
    });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessingFile(true);
    setError(null);
    setUserTranscript('');
    setMalayalamTranslation('');

    try {
      const base64Data = await fileToBase64(file);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            { inlineData: { mimeType: file.type, data: base64Data } },
            { text: "You are an expert audio processor. Transcribe the audio first, then provide a translation of the transcription in Malayalam. Respond ONLY with a JSON object containing 'transcription' and 'translation' keys." }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              transcription: {
                type: Type.STRING,
                description: "The transcribed text from the audio in its original language."
              },
              translation: {
                type: Type.STRING,
                description: "The Malayalam translation of the transcribed text."
              }
            },
            required: ['transcription', 'translation']
          }
        }
      });
      
      const jsonString = response.text.trim();
      const result = JSON.parse(jsonString);

      if (result.transcription || result.translation) {
        setHistory(prev => [...prev, { user: result.transcription, translation: result.translation }]);
        setUserTranscript(result.transcription);
        setMalayalamTranslation(result.translation);
      } else {
        throw new Error("Received empty transcription/translation.");
      }

    } catch (err: any) {
      console.error("File processing error:", err);
      setError(`Failed to process audio file: ${err.message || 'Unknown error'}`);
    } finally {
      setIsProcessingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };
  
  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, [stopRecording]);

  const getStatusText = () => {
    if (isConnecting) return "Connecting...";
    if (isRecording) return "Recording... Click to stop";
    if (isProcessingFile) return "Processing audio file...";
    return "Click to record or upload an audio file";
  };

  const isBusy = isConnecting || isRecording || isProcessingFile;

  return (
    <div className="flex flex-col min-h-screen bg-gray-900 bg-gradient-to-br from-gray-900 via-indigo-900/40 to-gray-900 text-gray-200 font-sans">
      <Header />
      
      <main className="flex-grow w-full max-w-4xl mx-auto p-4 flex flex-col gap-6">
        <div className="grid md:grid-cols-2 gap-6 flex-grow">
          <TranscriptionCard title="Your Speech" text={userTranscript} />
          <TranscriptionCard title="Malayalam Translation" text={malayalamTranslation} lang="ml" />
        </div>
        
        {history.length > 0 && (
          <div className="mt-4">
            <h2 className="text-xl font-semibold text-white mb-2 border-b border-indigo-800/50 pb-2">History</h2>
            <div className="bg-gray-800/50 rounded-lg p-4 space-y-4 max-h-48 overflow-y-auto">
              {history.slice().reverse().map((item, index) => (
                <div key={index} className="border-b border-indigo-900/60 pb-2 last:border-b-0">
                  <p className="text-gray-400"><strong className="text-gray-300">You:</strong> {item.user}</p>
                  <p className="text-blue-300" lang="ml"><strong className="text-blue-200">Translation:</strong> {item.translation}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
            <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg text-center" role="alert">
                <p>{error}</p>
            </div>
        )}
      </main>

      <footer className="sticky bottom-0 left-0 right-0 bg-gray-900/60 backdrop-blur-sm p-4 border-t border-indigo-800/50">
        <div className="max-w-4xl mx-auto flex flex-col items-center justify-center gap-4">
          <div className="flex items-center gap-6">
            <button
              onClick={handleToggleRecording}
              disabled={isConnecting || isProcessingFile}
              className={`flex items-center justify-center w-16 h-16 rounded-full text-white transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed ${
                isRecording 
                ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500' 
                : 'bg-blue-600 hover:bg-blue-700 focus:ring-indigo-500'
              }`}
            >
              {isConnecting ? <LoadingIcon className="w-8 h-8"/> : (isRecording ? <StopIcon className="w-8 h-8"/> : <MicrophoneIcon className="w-8 h-8"/>)}
            </button>
            <input
              type="file"
              id="audio-upload"
              ref={fileInputRef}
              accept=".mp3,.aac,.ogg,.wma,audio/*"
              onChange={handleFileUpload}
              className="hidden"
              disabled={isBusy}
            />
            <label
              htmlFor="audio-upload"
              className={`flex items-center justify-center w-16 h-16 rounded-full text-white transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-offset-2 focus:ring-offset-gray-900 ${
                isBusy
                  ? 'bg-gray-600 opacity-50 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700 focus:ring-green-500 cursor-pointer'
              }`}
            >
              {isProcessingFile ? <LoadingIcon className="w-8 h-8"/> : <UploadIcon className="w-8 h-8"/>}
            </label>
          </div>
          <p className="text-sm text-gray-400 h-5">
            {getStatusText()}
          </p>
        </div>
      </footer>
    </div>
  );
};

export default App;
