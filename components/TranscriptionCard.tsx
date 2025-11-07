
import React from 'react';

type TranscriptionCardProps = {
  title: string;
  text: string;
  lang?: string;
};

export const TranscriptionCard: React.FC<TranscriptionCardProps> = ({ title, text, lang }) => {
  return (
    <div className="bg-gray-800/80 backdrop-blur-sm rounded-lg shadow-lg p-4 flex flex-col h-full min-h-[150px]">
      <h2 className="text-lg font-semibold text-gray-300 border-b border-indigo-800/50 pb-2 mb-2">
        {title}
      </h2>
      <div className="flex-grow overflow-y-auto">
        {text ? (
          <p className="text-gray-200 whitespace-pre-wrap" lang={lang}>
            {text}
          </p>
        ) : (
          <p className="text-gray-500 italic">Waiting for audio...</p>
        )}
      </div>
    </div>
  );
};
